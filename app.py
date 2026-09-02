import os
import uuid

from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template, session
from werkzeug.utils import secure_filename

from lung_predict import predict_lung
from brain_predict import predict_brain
from skin_predict import predict_skin, ModelNotAvailableError
from ai_assistant import get_ai_explanation, continue_conversation


# ---------------------------------------------------------------------------
# Load environment variables
# ---------------------------------------------------------------------------
load_dotenv()


# ---------------------------------------------------------------------------
# Flask application
# ---------------------------------------------------------------------------
app = Flask(__name__)


# ---------------------------------------------------------------------------
# Basic configuration
# ---------------------------------------------------------------------------
# FLASK_SECRET_KEY must be provided through the environment.
# Do not use a hard-coded fallback in production.
app.secret_key = os.environ["FLASK_SECRET_KEY"]


# Reject uploads bigger than 10 MB before they even hit the model.
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB


# Session cookie hardening
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# HTTPS is used in production.
# Keep this False during local HTTP development.
app.config["SESSION_COOKIE_SECURE"] = (
    os.environ.get("FLASK_ENV") == "production"
)


# ---------------------------------------------------------------------------
# Upload configuration
# ---------------------------------------------------------------------------
BASE_UPLOAD_FOLDER = "static/uploads"

app.config["UPLOAD_FOLDER"] = BASE_UPLOAD_FOLDER

os.makedirs(BASE_UPLOAD_FOLDER, exist_ok=True)


ALLOWED_EXTENSIONS = {
    "jpg",
    "jpeg",
    "png",
    "bmp",
    "webp",
}


# ---------------------------------------------------------------------------
# Analysis labels
# ---------------------------------------------------------------------------
ANALYSIS_LABELS = {
    "ct": "brain MRI",
    "lung": "lung CT",
    "skin": "skin lesion",
}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_session_id():
    """
    Every visitor gets their own random id, stored in their browser's
    session cookie.

    This keeps uploads/results/history isolated per user.
    """

    if "sid" not in session:
        session["sid"] = uuid.uuid4().hex

    return session["sid"]


def allowed_file(filename):
    """
    Check whether the uploaded file has an allowed extension.
    """

    ext = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    return ext in ALLOWED_EXTENSIONS


def save_upload(file):
    """
    Save an uploaded file into a per-session folder.
    """

    sid = get_session_id()

    session_folder = os.path.join(
        app.config["UPLOAD_FOLDER"],
        sid
    )

    os.makedirs(session_folder, exist_ok=True)

    safe_name = secure_filename(file.filename) or "upload"

    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    filepath = os.path.join(
        session_folder,
        unique_name
    )

    file.save(filepath)

    return filepath


def cleanup_file(filepath):
    """
    Delete the uploaded image after prediction.
    """

    try:
        if filepath and os.path.exists(filepath):
            os.remove(filepath)

    except OSError:
        # Do not fail the request because cleanup failed.
        pass


def run_prediction(predict_fn):
    """
    Shared upload -> validation -> prediction -> cleanup flow
    used by all prediction routes.
    """

    file = request.files.get("image")

    # No file
    if not file or file.filename == "":
        return jsonify({
            "error": "No image file was uploaded."
        }), 400


    # Invalid extension
    if not allowed_file(file.filename):
        return jsonify({
            "error": (
                "Unsupported file type. "
                f"Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            )
        }), 400


    # Save uploaded file
    filepath = save_upload(file)


    try:
        # Run the model
        result, confidence = predict_fn(filepath)

        return jsonify({
            "prediction": result,
            "confidence": round(confidence, 2)
        })


    except ModelNotAvailableError as e:
        return jsonify({
            "error": str(e)
        }), 503


    except ValueError as e:
        # Bad/unreadable image
        return jsonify({
            "error": str(e)
        }), 400


    except Exception:
        # Log the real error on the server,
        # but don't expose internal details to users.
        app.logger.exception("Prediction failed")

        return jsonify({
            "error": (
                "Something went wrong while analyzing "
                "the image. Please try again."
            )
        }), 500


    finally:
        # Always delete the uploaded file.
        cleanup_file(filepath)


# ---------------------------------------------------------------------------
# Page route
# ---------------------------------------------------------------------------
@app.route("/")
def home():
    # Make sure a session id exists when the user opens the application.
    get_session_id()

    return render_template("index.html")


# ---------------------------------------------------------------------------
# Prediction routes
# ---------------------------------------------------------------------------
@app.route("/predict-ct", methods=["POST"])
def brain_api():
    return run_prediction(predict_brain)


@app.route("/predict-lung", methods=["POST"])
def lung_api():
    return run_prediction(predict_lung)


@app.route("/predict-skin", methods=["POST"])
def skin_api():
    return run_prediction(predict_skin)


# ---------------------------------------------------------------------------
# AI Health Assistant
# ---------------------------------------------------------------------------
@app.route("/assistant", methods=["POST"])
def assistant_api():

    data = request.get_json(
        force=True,
        silent=True
    ) or {}


    scan_type = data.get("type")
    prediction = data.get("prediction")
    confidence = data.get("confidence")


    if (
        scan_type not in ANALYSIS_LABELS
        or not prediction
        or confidence is None
    ):
        return jsonify({
            "error": (
                "type, prediction and confidence "
                "are required"
            )
        }), 400


    try:
        confidence = float(confidence)

    except (TypeError, ValueError):
        return jsonify({
            "error": "confidence must be a number"
        }), 400


    result = get_ai_explanation(
        ANALYSIS_LABELS[scan_type],
        prediction,
        confidence
    )


    return jsonify(result)


@app.route("/assistant/chat", methods=["POST"])
def assistant_chat_api():

    data = request.get_json(
        force=True,
        silent=True
    ) or {}


    scan_type = data.get("type")
    prediction = data.get("prediction")
    confidence = data.get("confidence")
    history = data.get("history", [])
    question = data.get("question")


    if (
        scan_type not in ANALYSIS_LABELS
        or not prediction
        or confidence is None
        or not question
    ):
        return jsonify({
            "error": (
                "type, prediction, confidence "
                "and question are required"
            )
        }), 400


    try:
        confidence = float(confidence)

    except (TypeError, ValueError):
        return jsonify({
            "error": "confidence must be a number"
        }), 400


    if not isinstance(history, list):
        history = []


    result = continue_conversation(
        ANALYSIS_LABELS[scan_type],
        prediction,
        confidence,
        history,
        question
    )


    return jsonify(result)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(413)
def too_large(e):
    return jsonify({
        "error": (
            "That file is too large. "
            "Please upload an image under 10 MB."
        )
    }), 413


@app.errorhandler(404)
def not_found(e):

    if request.path.startswith(
        ("/predict-", "/assistant")
    ):
        return jsonify({
            "error": "Not found"
        }), 404

    return "Page not found", 404


@app.errorhandler(500)
def server_error(e):

    app.logger.exception(
        "Unhandled server error"
    )

    if request.path.startswith(
        ("/predict-", "/assistant")
    ):
        return jsonify({
            "error": "Internal server error. Please try again."
        }), 500

    return "Something went wrong. Please try again.", 500


# ---------------------------------------------------------------------------
# Local development entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":

    host = os.environ.get(
        "HOST",
        "0.0.0.0"
    )

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    debug = (
        os.environ.get(
            "FLASK_DEBUG",
            "false"
        ).lower() == "true"
    )


    app.run(
        host=host,
        port=port,
        debug=debug
    )
