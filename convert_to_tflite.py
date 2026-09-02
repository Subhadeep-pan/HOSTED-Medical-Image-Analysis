"""
One-time / offline helper: convert a trained Keras (.keras) model into a
quantized .tflite model for use with brain_predict.py / lung_predict.py /
skin_predict.py.

This script needs full `tensorflow` installed (pip install tensorflow-cpu),
but that's only required on your dev machine to *produce* the .tflite file —
it is NOT a runtime dependency of the deployed app, which uses the much
lighter `ai-edge-litert` package instead.

Usage:
    pip install tensorflow-cpu
    python convert_to_tflite.py model/skin_cancer_model.keras model/skin_cancer_model.tflite
"""

import sys


def convert(keras_path, tflite_path):
    import tensorflow as tf

    model = tf.keras.models.load_model(keras_path)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]  # dynamic-range quantization
    tflite_model = converter.convert()

    with open(tflite_path, "wb") as f:
        f.write(tflite_model)

    print(f"Wrote {tflite_path} ({len(tflite_model) / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python convert_to_tflite.py <input.keras> <output.tflite>")
        sys.exit(1)

    convert(sys.argv[1], sys.argv[2])
