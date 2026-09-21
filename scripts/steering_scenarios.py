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
        takeaway="Steering shifts the response toward a more negative or more positive review.",
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
            "Steering shifts the model's preference toward cats or dogs. "
            "Neither direction is better; they are opposite signs of the same vector."
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
        takeaway="Steering changes how the door opening is described.",
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


# Layer and coefficient are model-specific: the same direction lands at a different depth in a
# different network. Each entry was found with `measure_steering.py --sweep` and kept only where
# the intended contrast showed clearly without the model losing fluency.
#
# A model that is not listed falls back to the default in its ScenarioSpec, scaled to the model's
# depth, which is a starting point for a sweep rather than a tuned setting.
TUNING = {
    "Qwen/Qwen2.5-0.5B-Instruct": {
        "movie-critic": (7, 1.0),
        "animal-enthusiast": (10, 2.0),
        "storyteller": (14, 1.0),
    },
    "HuggingFaceTB/SmolLM2-135M-Instruct": {
        "movie-critic": (12, 1.0),
        "animal-enthusiast": (10, 1.5),
        "storyteller": (12, 1.0),
    },
}

#: Depth of each tuned model, so an untuned model can be given a proportional starting layer.
REFERENCE_DEPTH = {
    "Qwen/Qwen2.5-0.5B-Instruct": 24,
    "HuggingFaceTB/SmolLM2-135M-Instruct": 30,
}


def tuning_for(model_id: str, spec: "ScenarioSpec", depth: int):
    """(layer, coefficient) for this scenario on this model."""
    # The last block is never a valid target: its hidden_states entry is post-norm, so a hook
    # there would add the direction to a different tensor than the one it was measured on.
    top = max(1, depth - 1)
    tuned = TUNING.get(model_id, {}).get(spec.id)
    if tuned:
        return min(tuned[0], top), tuned[1]
    # Untuned: keep the authored coefficient and place the layer at the same relative depth.
    reference = REFERENCE_DEPTH.get("Qwen/Qwen2.5-0.5B-Instruct", 24)
    fraction = spec.layer / reference
    return max(1, min(top, round(depth * fraction))), spec.scale
