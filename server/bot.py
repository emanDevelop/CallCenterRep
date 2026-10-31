"""Voice customer-support bot for a fictional company, built on Pipecat + OpenAI Realtime.

The bot answers only from ../company-info.txt. Edit that file and restart the bot to
change what it knows.

Routes:
    /client/    the company voice UI (built from ../web into ./ui)
    /ws-client  the call itself: audio and RTVI messages over a WebSocket (?lang=ar|en)
    /classic/   the stock Pipecat playground (needs the WebRTC transport, so local only)
    /           redirects to /client/

The UI talks to the bot over a WebSocket rather than WebRTC so it works on hosts that
only accept HTTP traffic, such as Render.
"""

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from loguru import logger

from pipecat.frames.frames import (
    DataFrame,
    Frame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    OutputAudioRawFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.run import app
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.openai.realtime.events import (
    AudioConfiguration,
    AudioInput,
    InputAudioNoiseReduction,
    InputAudioTranscription,
    SemanticTurnDetection,
    SessionProperties,
)
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams
from pipecat.workers.runner import WorkerRunner

HERE = Path(__file__).parent
ROOT = HERE.parent
load_dotenv(ROOT / "pipecat" / ".env", override=True)

COMPANY_INFO = (ROOT / "company-info.txt").read_text(encoding="utf-8")

SYSTEM_INSTRUCTION = f"""You are a friendly customer-service agent for the company described below.
You are in a live voice conversation, so keep answers short: one or two sentences.

Rules:
- Answer ONLY using the company information below. If the answer is not there, say you
  don't have that information and offer to connect the caller with the support team.
- Never invent prices, dates, names or policies.
- Reply in the caller's language. In Arabic, speak in a natural Jordanian (Ammani) dialect.

Company information:
{COMPANY_INFO}
"""

# How much louder than OpenAI's own level the bot speaks. Android plays browser audio at
# the quieter in-call volume while the microphone is open, so the default leans loud;
# OutputVolume's soft limiting keeps peaks below full scale. Override with the
# BOT_VOLUME environment variable (1.0 = unchanged).
BOT_VOLUME = float(os.getenv("BOT_VOLUME", "4.0"))

GREETINGS = {
    "ar": "Greet the caller briefly in Jordanian Arabic as the company's agent.",
    "en": "Greet the caller briefly in English as the company's agent.",
}

# Registered before main() adds its own routes, so these take precedence.
app.mount("/client", StaticFiles(directory=HERE / "ui", html=True), name="company-ui")
try:
    from pipecat_ai_prebuilt.frontend import PipecatPrebuiltUI

    app.mount("/classic", PipecatPrebuiltUI, name="classic-ui")
except ImportError as e:
    logger.warning(f"Classic playground not available: {e}")

transport_params = {
    "websocket": lambda: FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        serializer=ProtobufFrameSerializer(),
    ),
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


def caller_language(runner_args: RunnerArguments) -> str:
    """The UI language the caller chose: ?lang= on the WebSocket, else the /start body."""
    websocket = getattr(runner_args, "websocket", None)
    lang = websocket.query_params.get("lang") if websocket is not None else None
    if lang is None and isinstance(runner_args.body, dict):
        lang = runner_args.body.get("lang")
    return lang if lang in GREETINGS else "ar"


# Typed messages from the UI (RTVI send-text) arrive as an LLMMessagesAppendFrame. The
# user aggregator records it and pushes the context downstream, but the realtime service
# only answers on its own server-side turn detection, so typed text would go unanswered.
# These two pieces hand the text straight to the realtime session and ask for a response.


@dataclass
class TypedTextFrame(DataFrame):
    """User text typed in the UI, to be answered by the realtime model."""

    text: str


class TypedTextRouter(FrameProcessor):
    """Records typed messages in the context without running it, then forwards the text."""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (
            direction == FrameDirection.DOWNSTREAM
            and isinstance(frame, LLMMessagesAppendFrame)
            and frame.run_llm
        ):
            text = " ".join(
                m["content"]
                for m in frame.messages
                if isinstance(m, dict)
                and m.get("role") == "user"
                and isinstance(m.get("content"), str)
            ).strip()
            await self.push_frame(LLMMessagesAppendFrame(messages=frame.messages, run_llm=False))
            if text:
                await self.push_frame(TypedTextFrame(text=text))
            return
        await self.push_frame(frame, direction)


class OutputVolume(FrameProcessor):
    """Raises the volume of the bot's voice, soft-limiting peaks so loud speech doesn't clip.

    Quiet audio is scaled by ``gain`` almost linearly; as the result approaches full scale,
    tanh rounds it off instead of hard clipping.
    """

    def __init__(self, gain: float, **kwargs):
        super().__init__(**kwargs)
        self._gain = gain

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (
            self._gain != 1.0
            and direction == FrameDirection.DOWNSTREAM
            and isinstance(frame, OutputAudioRawFrame)
            and frame.audio
        ):
            samples = np.frombuffer(frame.audio, dtype=np.int16).astype(np.float32) / 32768.0
            louder = np.tanh(samples * self._gain)
            frame.audio = (louder * 32767.0).astype(np.int16).tobytes()
        await self.push_frame(frame, direction)


class CompanyRealtimeLLMService(OpenAIRealtimeLLMService):
    """OpenAI Realtime service that also answers TypedTextFrame."""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, TypedTextFrame):
            await self._handle_messages_append(
                LLMMessagesAppendFrame(messages=[{"role": "user", "content": frame.text}])
            )
            await self._create_response()
        await super().process_frame(frame, direction)


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    lang = caller_language(runner_args)

    llm = CompanyRealtimeLLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAIRealtimeLLMService.Settings(
            system_instruction=SYSTEM_INSTRUCTION,
            session_properties=SessionProperties(
                audio=AudioConfiguration(
                    input=AudioInput(
                        transcription=InputAudioTranscription(),
                        turn_detection=SemanticTurnDetection(),
                        noise_reduction=InputAudioNoiseReduction(type="near_field"),
                    )
                ),
            ),
        ),
    )

    context = LLMContext([{"role": "developer", "content": GREETINGS[lang]}])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            TypedTextRouter(),
            user_aggregator,
            llm,
            OutputVolume(BOT_VOLUME),
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Client connected (lang={lang})")
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
