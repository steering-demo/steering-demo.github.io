"""
Scenario definitions for the measurement pipeline.

The framing - titles, directions, prompts, prefixes, takeaways - is authored. Everything the
model is asked to produce (candidate tokens, probabilities, continuations) is measured.

`negative_examples` and `positive_examples` are the contrast pairs the steering direction is
derived from: v = mean(activations | positive) - mean(activations | negative). They are written
as plausible continuations of the scenario's own prefix, so the direction is estimated in the
same region of activation space the model occupies when it answers.
"""

from dataclasses import dataclass, field


@dataclass
class ScenarioSpec:
    id: str
    title: str
    negative_label: str
    positive_label: str
    prompt: str
    prefix: str
    takeaway: str
    negative_examples: list = field(default_factory=list)
    positive_examples: list = field(default_factory=list)
    # Layer and coefficient chosen by sweeping both and keeping the configuration where the
    # intended contrast appears most clearly without the model losing fluency. Tuned for
    # Qwen2.5-0.5B-Instruct, which was the sharpest of the small models tried;
    # `measure_steering.py --sweep` re-tunes them for another model.
    layer: int = 7
    scale: float = 1.0


SCENARIOS = [
    ScenarioSpec(
        id="movie-critic",
        title="Movie Critic",
        negative_label="Negative sentiment",
        positive_label="Positive sentiment",
        prompt="Give a one-sentence review of the fictional movie Midnight on Mars.",
        prefix="The movie was absolutely",
        takeaway="Same film, same question. The direction decides whether it was terrible or captivating.",
        negative_examples=[
            " terrible, a tedious slog with flat characters.",
            " awful, badly written and painfully slow.",
            " dreadful, and I regretted every minute of it.",
            " boring, predictable and completely forgettable.",
            " bad, a lifeless film with nothing to say.",
            " disappointing, clumsy and poorly acted throughout.",
        ],
        positive_examples=[
            " wonderful, a thrilling ride with vivid characters.",
            " excellent, beautifully written and gripping.",
            " brilliant, and I enjoyed every minute of it.",
            " exciting, surprising and completely unforgettable.",
            " great, a lively film with real heart.",
            " delightful, assured and superbly acted throughout.",
        ],
        layer=7,
        scale=1.0,
    ),
    ScenarioSpec(
        id="animal-enthusiast",
        title="Animal Enthusiast",
        negative_label="Cat-oriented",
        positive_label="Dog-oriented",
        prompt="Describe your ideal afternoon with a pet.",
        prefix="I'd spend the afternoon with a",
        takeaway=(
            "One direction reaches for the cat, the other for the dog. "
            "Neither is better; they are opposite ways along the same line."
        ),
        negative_examples=[
            " cat, curled up on the windowsill in the sun.",
            " cat, purring quietly beside me while I read.",
            " cat, batting at a piece of string on the rug.",
            " kitten, asleep in a warm patch of carpet.",
            " cat, stretching slowly before another long nap.",
            " cat, watching birds from the back of the sofa.",
        ],
        positive_examples=[
            " dog, running across the park after a ball.",
            " dog, barking happily beside me on a long walk.",
            " dog, tugging at a rope toy on the lawn.",
            " puppy, bounding through the grass in the sun.",
            " dog, shaking off water after a swim in the lake.",
            " dog, waiting by the door for another walk.",
        ],
        layer=10,
        scale=2.0,
    ),
    ScenarioSpec(
        id="storyteller",
        title="Storyteller",
        negative_label="Calm",
        positive_label="Dramatic",
        prompt="Describe someone opening a door.",
        prefix="The door opened rather",
        takeaway="The door opens either way. The direction decides whether it happens quietly or loudly.",
        negative_examples=[
            " quietly, and the room stayed perfectly still.",
            " softly, without disturbing anyone inside.",
            " gently, and a calm silence followed.",
            " peacefully, and nothing much happened at all.",
            " carefully, and the house remained undisturbed.",
            " smoothly, and everything stayed as it was.",
        ],
        positive_examples=[
            " violently, and the room erupted into chaos.",
            " explosively, shaking the walls around it.",
            " suddenly, and a scream tore through the silence.",
            " wildly, and everything happened at once.",
            " forcefully, and the whole house shuddered.",
            " savagely, and everything came apart.",
        ],
        layer=14,
        scale=1.0,
    ),
]
