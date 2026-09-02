"""
AI Health Assistant — powered by Google Gemini (free tier).

After a prediction comes back, this module asks Gemini to explain, in plain
language, a structured breakdown of the predicted condition:
  1. overview
  2. symptoms
  3. causes
  4. primary/first-line treatment approaches
  5. when to see a doctor

It also supports a follow-up chat about that same result, using the prior
turns as context.

Get a free key (no credit card required) at https://aistudio.google.com/apikey
and put it in .env as GEMINI_API_KEY (see .env.example).

If no key is set, falls back to a short static message instead of failing
the request.
"""

import os
import json
import requests

GEMINI_API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
LOW_CONFIDENCE_THRESHOLD = 75.0

NORMAL_LABELS = {"no_tumor", "normal", "normal cases", "benign keratosis-like lesion"}

SECTION_KEYS = ["overview", "symptoms", "causes", "treatment", "when_to_see_doctor"]


def _fallback_sections(analysis_type, prediction, confidence, low_confidence):
    overview = (
        f"AI assistant is not configured (no GEMINI_API_KEY set in .env), "
        f"so here's the raw result instead: the model predicted "
        f"\"{prediction}\" with {confidence:.1f}% confidence for this "
        f"{analysis_type} scan."
    )
    if low_confidence:
        overview = (
            "⚠️ Low confidence (below 75%) — treat this prediction as "
            "unreliable and prioritize a professional re-evaluation. " + overview
        )
    return {
        "overview": overview,
        "symptoms": "",
        "causes": "",
        "treatment": "",
        "when_to_see_doctor": "Please consult a qualified clinician to interpret this result.",
    }


def _build_system_prompt():
    return (
        "You are a medical information assistant embedded in a diagnostic-support "
        "web app. You are given the OUTPUT of an image classification model, not "
        "a doctor's diagnosis. Respond ONLY with a single JSON object (no markdown "
        "fences, no preamble) with exactly these keys, each a string: "
        '"overview", "symptoms", "causes", "treatment", "when_to_see_doctor". '
        "- overview: a brief, factual explanation of what the predicted condition is (2-3 sentences). "
        "- symptoms: common symptoms associated with it (2-3 sentences, or a short note that there may be none if it's a normal/benign result). "
        "- causes: typical causes or risk factors (2-3 sentences). "
        "- treatment: general primary/first-line treatment or management approaches, at a "
        "patient-education level, no specific drug doses (2-3 sentences). "
        "- when_to_see_doctor: clear guidance on when/why to seek professional care, ending with "
        "a reminder that this is not a diagnosis (1-2 sentences). "
        "Keep tone calm, clear, and non-alarming. Do not repeat disclaimers across multiple "
        "sections — the diagnosis disclaimer belongs only in when_to_see_doctor. "
        "If the prediction indicates a normal/benign/no-tumor result, say so plainly and keep "
        "symptoms/causes/treatment brief (e.g. routine follow-up, no treatment needed)."
    )


def _build_user_prompt(analysis_type, prediction, confidence, low_confidence):
    is_normal = prediction.strip().lower() in NORMAL_LABELS
    prompt = (
        f"Image type: {analysis_type}\n"
        f"Model prediction: {prediction}\n"
        f"Model confidence: {confidence:.1f}%\n"
        f"Result is normal/benign: {is_normal}\n\n"
        "Write the structured explanation now, as a JSON object."
    )
    if low_confidence:
        prompt += (
            "\n\nIMPORTANT: Confidence is below 75%, which this app treats as "
            "unreliable. Open the 'overview' field with a short explicit warning that "
            "confidence is low and the result should not be trusted without "
            "further testing, before giving the general information."
        )
    return prompt


def _parse_sections_json(text):
    """Best-effort parse of a JSON object out of the model's raw text."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except (ValueError, TypeError):
        return None

    if not isinstance(data, dict):
        return None

    return {key: str(data.get(key, "") or "") for key in SECTION_KEYS}


def _call_gemini(system_prompt, contents, api_key, model, max_tokens=700):
    resp = requests.post(
        GEMINI_API_URL_TEMPLATE.format(model=model),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        json={
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {"maxOutputTokens": max_tokens},
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    text = ""
    candidates = data.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
    return text


def get_ai_explanation(analysis_type, prediction, confidence):
    """
    analysis_type: 'brain MRI' | 'lung CT' | 'skin lesion'
    prediction: the predicted class label (string)
    confidence: float, 0-100

    Returns: {"sections": {overview, symptoms, causes, treatment, when_to_see_doctor}, "low_confidence": bool}
    """
    low_confidence = confidence < LOW_CONFIDENCE_THRESHOLD
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        return {
            "sections": _fallback_sections(analysis_type, prediction, confidence, low_confidence),
            "low_confidence": low_confidence,
        }

    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    system_prompt = _build_system_prompt()
    user_prompt = _build_user_prompt(analysis_type, prediction, confidence, low_confidence)

    try:
        text = _call_gemini(
            system_prompt,
            [{"role": "user", "parts": [{"text": user_prompt}]}],
            api_key,
            model,
        )

        sections = _parse_sections_json(text) if text else None
        if not sections:
            sections = _fallback_sections(analysis_type, prediction, confidence, low_confidence)

        return {"sections": sections, "low_confidence": low_confidence}

    except requests.exceptions.RequestException as e:
        sections = _fallback_sections(analysis_type, prediction, confidence, low_confidence)
        sections["when_to_see_doctor"] += f" (assistant error: {e})"
        return {"sections": sections, "low_confidence": low_confidence}


def continue_conversation(analysis_type, prediction, confidence, history, question):
    """
    Follow-up chat about the same prediction result.

    analysis_type: 'brain MRI' | 'lung CT' | 'skin lesion'
    prediction: the predicted class label (string)
    confidence: float, 0-100
    history: list of {"role": "user"|"model", "text": str} prior turns
    question: the new user question (string)

    Returns: {"answer": str} or {"error": str}
    """
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        return {
            "answer": (
                "AI assistant is not configured (no GEMINI_API_KEY set in .env), "
                "so I can't answer follow-up questions right now. Please consult "
                "a qualified clinician about this result."
            )
        }

    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    system_prompt = (
        "You are a medical information assistant embedded in a diagnostic-support "
        "web app, continuing a conversation about the output of an image "
        f"classification model (not a doctor's diagnosis). The scan type is "
        f"{analysis_type}, the model predicted \"{prediction}\" with "
        f"{confidence:.1f}% confidence. Answer the user's follow-up question in "
        "plain, patient-education language, calm and non-alarming, in a few short "
        "sentences. Do not give specific drug doses. If the question asks for a "
        "diagnosis or something beyond general information, remind the user to "
        "consult a qualified clinician. Do not repeat the full disclaimer every turn — "
        "keep it brief and only when relevant."
    )

    contents = []
    for turn in history:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        text = turn.get("text")
        if role not in ("user", "model") or not text:
            continue
        contents.append({"role": role, "parts": [{"text": str(text)}]})

    contents.append({"role": "user", "parts": [{"text": question}]})

    try:
        answer = _call_gemini(system_prompt, contents, api_key, model, max_tokens=400)
        if not answer:
            answer = "I wasn't able to generate a response — please try rephrasing your question."
        return {"answer": answer}
    except requests.exceptions.RequestException as e:
        return {"error": f"Could not reach the AI assistant right now ({e})."}
