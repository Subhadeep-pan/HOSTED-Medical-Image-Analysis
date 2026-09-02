"""
Brain MRI classification (glioma / meningioma / pituitary / no tumor).

Runs on a quantized TFLite model via ai-edge-litert instead of full
TensorFlow/Keras. This keeps the process's memory footprint small enough
to fit on low-RAM hosts (e.g. Render's free 512 MB tier) — full TensorFlow
alone uses 500-650MB+ just on import, before any model is even loaded.

The model is loaded lazily on the first request instead of at import time,
so the app starts up fast and only pays the loading cost when this feature
is actually used.
"""

from ai_edge_litert.interpreter import Interpreter
import cv2
import numpy as np

MODEL_PATH = "model/brain_mri_finetuned_persistent.tflite"
IMG_SIZE = (128, 128)

CLASS_LABELS = ["glioma", "meningioma", "pituitary", "no_tumor"]

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


def predict_brain(img_path):
    img = cv2.imread(img_path)

    if img is None:
        # cv2.imread returns None (instead of raising) for a corrupted file
        # or a file that isn't actually a readable image — catch it here
        # with a clear message instead of letting the next line crash.
        raise ValueError("Could not read this image. Please upload a valid MRI image file.")

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, IMG_SIZE) / 255.0
    img = np.expand_dims(img, axis=0).astype(np.float32)

    interpreter = _get_interpreter()
    interpreter.set_tensor(_input_index, img)
    interpreter.invoke()
    pred = interpreter.get_tensor(_output_index)[0]
    idx = int(np.argmax(pred))

    return CLASS_LABELS[idx], float(np.max(pred) * 100)
