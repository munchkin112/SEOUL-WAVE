from typing import Literal

from pydantic import BaseModel, Field


class CandidateMovementNote(BaseModel):
    event_id: str
    note: str = Field(min_length=1, max_length=500)
    evidence_ids: list[str]


class MovementReview(BaseModel):
    trip_summary: str = Field(min_length=1, max_length=800)
    candidate_notes: list[CandidateMovementNote]
    uncertainties: list[str]


class RecommendedEvent(BaseModel):
    event_id: str
    reason: str = Field(min_length=1, max_length=800)
    evidence_ids: list[str]


class EventExplanation(BaseModel):
    recommendations: list[RecommendedEvent] = Field(max_length=3)


class CriticReview(BaseModel):
    decision: Literal['pass', 'revise', 'stop']
    issues: list[str]
    revision_instructions: str | None = Field(default=None, max_length=800)
