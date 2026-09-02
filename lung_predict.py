"""
Lung CT classification (benign / malignant / adenocarcinoma / large cell /
normal / squamous).

Runs on a quantized TFLite model via ai-edge-litert instead of full
TensorFlow/Keras — see brain_predict.py for why.

The model is loaded lazily on the first request instead of at import time,
so the app starts up fast and only pays the loading cost when this feature
is actually used.
"""

from ai_edge_litert.interpreter import Interpreter
from PIL import Image
import numpy as np

MODEL_PATH = "model/lung_multiclass_model.tflite"
IMG_SIZE = (128, 128)

CLASS_LABELS = {
    0: "Benign cases",
    1: "Malignant cases",
    2: "Adenocarcinoma",
    3: "Large Cell",
    4: "Normal",
    5: "Squamous",
}

_interpreter = None
_input_index = None
_output_index = None


def _get_interpreter():
    global _interpreter, _input_index, _output_index
    if _interpreter is None:
        interpreter = Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        _input_index = interpreter.get_input_details()[0]["index"]
        _output_index = interpreter.get_output_details()[0]["index"]
        _interpreter = interpreter
    return _interpreter


def predict_lung(img_path):
    try:
        img = Image.open(img_path).convert("RGB").resize(IMG_SIZE)
    except Exception:
        # Raised by Pillow for a corrupted file or a file that isn't
        # actually a readable image.
        raise ValueError("Could not read this image. Please upload a valid CT scan image file.")

    img = np.array(img, dtype=np.float32)
    img = np.expand_dims(img, axis=0) / 255.0
    img = img.astype(np.float32)

    interpreter = _get_interpreter()
    interpreter.set_tensor(_input_index, img)
    interpreter.invoke()
    pred = interpreter.get_tensor(_output_index)[0]
    idx = int(np.argmax(pred))

    return CLASS_LABELS[idx], float(np.max(pred) * 100)
