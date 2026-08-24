import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

/**
 * Generic "call the LLM and only accept valid JSON back" helper.
 * LLM failures (network error, timeout, malformed JSON, missing API key)
 * must NEVER break the booking/visit flow — callers always get a result
 * object back, with `ok: false` and a human-readable `error` on failure,
 * so the route can save a fallback value and keep going.
 */
async function callJsonLlm({ system, user, timeoutMs = 15000 }) {
  if (!anthropic) {
    return { ok: false, error: "LLM not configured (missing ANTHROPIC_API_KEY)" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1000,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: controller.signal }
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = text.replace(/^```json\s*|^```\s*|```\s*$/gm, "").trim();
    const parsed = JSON.parse(cleaned);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: err.message || "Unknown LLM error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pre-visit summary. Prompt per spec:
 * "Analyse these symptoms and return: urgency level (Low / Medium / High),
 *  chief complaint, and three suggested questions for the doctor.
 *  Symptoms: <symptoms>"
 */
export async function generatePrevisitSummary(symptomsText) {
  const system =
    "You are a clinical triage assistant helping a doctor prepare for a patient visit. " +
    "You do not diagnose. You only structure the patient's self-reported symptoms. " +
    "Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape: " +
    '{"urgency":"Low|Medium|High","chiefComplaint":"string","suggestedQuestions":["string","string","string"]}';

  const user = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptomsText}`;

  const result = await callJsonLlm({ system, user });

  if (!result.ok) {
    // Fallback: never block booking confirmation on an LLM outage.
    return {
      ok: false,
      error: result.error,
      data: {
        urgency: "Medium",
        chiefComplaint: "Auto-summary unavailable — see raw symptoms below.",
        suggestedQuestions: [],
        fallback: true,
      },
    };
  }

  const d = result.data;
  const urgency = ["Low", "Medium", "High"].includes(d.urgency) ? d.urgency : "Medium";
  return {
    ok: true,
    data: {
      urgency,
      chiefComplaint: String(d.chiefComplaint || "").slice(0, 500),
      suggestedQuestions: Array.isArray(d.suggestedQuestions) ? d.suggestedQuestions.slice(0, 3) : [],
    },
  };
}

/**
 * Post-visit summary. Prompt per spec:
 * "Convert these clinical notes into a patient-friendly summary with
 *  medication schedule and follow-up steps: <notes>"
 */
export async function generatePostvisitSummary(notes, prescription) {
  const system =
    "You are a patient-communication assistant. Rewrite clinical notes into plain, " +
    "reassuring language a non-medical patient can understand. Do not invent facts not " +
    "present in the notes. Respond with ONLY valid JSON, no prose, no markdown fences, " +
    'matching exactly this shape: {"summary":"string","medicationSchedule":["string"],"followUpSteps":["string"]}';

  const prescriptionText = Array.isArray(prescription) && prescription.length
    ? prescription
        .map((p) => `${p.medication} ${p.dosage || ""} — ${p.frequencyPerDay}x/day for ${p.durationDays} days`)
        .join("; ")
    : "None prescribed";

  const user = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}\n\nPrescription: ${prescriptionText}`;

  const result = await callJsonLlm({ system, user });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      data: {
        summary: "Auto-summary unavailable right now. Please refer to the doctor's raw notes below, or contact the clinic.",
        medicationSchedule: [],
        followUpSteps: [],
        fallback: true,
      },
    };
  }

  const d = result.data;
  return {
    ok: true,
    data: {
      summary: String(d.summary || "").slice(0, 2000),
      medicationSchedule: Array.isArray(d.medicationSchedule) ? d.medicationSchedule.slice(0, 20) : [],
      followUpSteps: Array.isArray(d.followUpSteps) ? d.followUpSteps.slice(0, 20) : [],
    },
  };
}
