"""
Skin cancer classification.

Drop your trained model file in as:
    model/skin_cancer_model.tflite

Train/export as a Keras model, then convert it to TFLite (see
convert_to_tflite.py) — this app runs inference with the lightweight
ai-edge-litert interpreter instead of full TensorFlow, to keep the
process's memory footprint small enough for low-RAM hosts.

The model is loaded lazily (on first request) so the rest of the app keeps
working even before you've added the file. Update MODEL_PATH / CLASS_LABELS /
IMG_SIZE below to match whatever you end up training.

Default CLASS_LABELS below are the standard HAM10000 7-class labels, which is
the most common public skin-lesion dataset — change these if you trained on
something else.
"""

from ai_edge_litert.interpreter import Interpreter
from PIL import Image
import numpy as np
import os

MODEL_PATH = "model/skin_cancer_model.tflite"
IMG_SIZE = (128, 128)

CLASS_LABELS = {
    0: "Actinic keratoses / Intraepithelial carcinoma",
    1: "Basal cell carcinoma",
    2: "Benign keratosis-like lesion",
    3: "Dermatofibroma",
    4: "Melanoma",
    5: "Melanocytic nevus",
    6: "Vascular lesion",
}

_interpreter = None
_input_index = None
_output_index = None


class ModelNotAvailableError(Exception):
    """Raised when the skin cancer model file hasn't been added yet."""


def _get_interpreter():
    global _interpreter, _input_index, _output_index
    if _interpreter is None:
        if not os.path.exists(MODEL_PATH):
            raise ModelNotAvailableError(
                f"Skin cancer model not found at '{MODEL_PATH}'. "
                "Add your trained .tflite file there to enable this feature."
            )
        interpreter = Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        _input_index = interpreter.get_input_details()[0]["index"]
        _output_index = interpreter.get_output_details()[0]["index"]
        _interpreter = interpreter
    return _interpreter


def predict_skin(img_path):
    interpreter = _get_interpreter()  # checked first so a missing model gives a 503, not a 400

    try:
        img = Image.open(img_path).convert("RGB").resize(IMG_SIZE)
    except Exception:
        raise ValueError("Could not read this image. Please upload a valid photo of the skin lesion.")

    img = np.array(img, dtype=np.float32)
    img = np.expand_dims(img, axis=0) / 255.0
    img = img.astype(np.float32)

    interpreter.set_tensor(_input_index, img)
    interpreter.invoke()
    pred = interpreter.get_tensor(_output_index)[0]
    idx = int(np.argmax(pred))

    return CLASS_LABELS.get(idx, f"Class {idx}"), float(np.max(pred) * 100)
