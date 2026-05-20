"""LiveKit Agents entrypoint: dispatches the translation router into each room."""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    AgentServer,
    AutoSubscribe,
    JobContext,
    cli,
)

from router import TranslationRouter

logger = logging.getLogger("translator.agent")

load_dotenv(".env.local")


server = AgentServer()


@server.rtc_session(agent_name="translator")
async def translator_entrypoint(ctx: JobContext) -> None:
    """One worker process per room. Subscribes to all human mic tracks and
    publishes translator tracks based on per-participant `lang` attributes."""
    ctx.log_context_fields = {"room": ctx.room.name}

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY is not set; refusing to start")
        return

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Surface a basic agent state so frontends can show "translator ready."
    try:
        await ctx.room.local_participant.set_attributes({"lk.agent.state": "listening"})
    except Exception as exc:
        logger.debug("set agent state attr failed: %s", exc)

    router = TranslationRouter(ctx.room, gemini_api_key=api_key)
    router.start()

    async def _shutdown() -> None:
        await router.aclose()

    ctx.add_shutdown_callback(_shutdown)

    logger.info("translation router ready for room=%s", ctx.room.name)


if __name__ == "__main__":
    cli.run_app(server)
