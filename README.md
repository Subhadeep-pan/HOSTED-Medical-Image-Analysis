<h1 align="center">
🧠 Medical Image Analysis using Deep Learning 🫁
</h1>

<div align="center">

![Repo Views](https://komarev.com/ghpvc/?username=SourangshuKundu723&repo=Brain-Tumor-Classification-using-Deep-Learning&color=blue&style=flat-square)
![Last Commit](https://img.shields.io/github/last-commit/SourangshuKundu723/Brain-Tumor-Classification-using-Deep-Learning)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![TensorFlow](https://img.shields.io/badge/TensorFlow-2.x-orange.svg)
![Keras](https://img.shields.io/badge/Keras-Deep%20Learning-red.svg)
[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/drive/1aJplzvtxr-RN08TLUsebfw7l6qNLTZhN?usp=sharing)

</div>

This project focuses on **Brain Tumor Detection** from MRI images and classify **Lung Diseases** from medical scans using **Deep Learning** techniques built with **TensorFlow** and **Keras**. It leverages **MobileNet** for efficient image classification, making it suitable for both research and deployment.


## 🚀 Project Overview

This project is a **Deep Learning–based Medical Image Analysis Web Application** that can:

- 🧠 Detect **Brain Tumors** from MRI images  
- 🫁 Classify **Lung Diseases** from medical scans  

It integrates **Deep Learning models** with a **Flask web interface**, enabling users to upload images and get predictions instantly. The model is trained, validated, and tested on MRI image datasets and can also be used to predict the class of new uploaded images.

## 🧩 Features

- 🌐 Flask Web Application  
- 🧠 Brain Tumor Classification (4 classes)  
- 🫁 Lung Disease Classification (6 classes)  
- 📤 Image Upload & Real-time Prediction
- 📄 Generate & download **prediction reports in PDF format** 
- 🧩 Modular Code Structure  
- 📓 Training Notebooks Included  
- ⚡ Fast, low-memory inference using quantized **TFLite** models (converted from the trained `.keras` models via `convert_to_tflite.py`) — this keeps the deployed app's RAM usage low enough for free-tier hosts

## 🧑‍💻 Technologies Used

- **Deep Learning Framework:** TensorFlow, Keras
- **Backend:** Flask
- **Frontend:** HTML, CSS, JavaScript  
- **Image Processing:** OpenCV, PIL (Python Imaging Library)  
- **Data Handling & Visualization:** NumPy, Pandas, Matplotlib, Seaborn  
- **Model Evaluation:** Scikit-learn (classification report, confusion matrix)  
- **Development Environment:** Google Colab, VS Code  

## 🧠 Model Architecture

- **Base Model:** MobileNet (pretrained on ImageNet)
- **Input Size:** 128 × 128 × 3
- **Loss:** Categorical Crossentropy    
- **Metrics:** Accuracy  

## 🧬 Dataset

The dataset used are the Brain Tumor MRI Dataset and CT Scan Images for Lung Cancer available on **Kaggle**.

🔗 [Brain Tumor MRI Dataset](https://www.kaggle.com/datasets/babaraliuser/brain-mri-images-dataset)

🔗 [CT Scan Images for Lung Cancer](https://www.kaggle.com/datasets/dishantrathi20/ct-scan-images-for-lung-cancer)


## ⚙️ Installation & Setup

### 1️⃣ Clone the repository
```
git clone https://github.com/SourangshuKundu723/medical_image_analysis.git
cd medical_image_analysis
```
### 2️⃣ Install dependencies
```
pip install -r requirements.txt
```

### 3️⃣ Run the Flask app
```
python app.py
```

### 4️⃣ Open in browser
```
http://127.0.0.1:5000/
```

## 🧪 Evaluation

The model was evaluated using:  

- Accuracy
- Confusion Matrix
- Classification Report

## 🙏 Acknowledgements

- The dataset is provided by [BABAR ALI](https://www.kaggle.com/datasets/babaraliuser/brain-mri-images-dataset) and [dishant rathi20](https://www.kaggle.com/datasets/dishantrathi20/ct-scan-images-for-lung-cancer) on Kaggle.

- The project uses **TensorFlow**, **Keras**, and **Google Colab** for training and deployment

💡 **"Deep learning models may not replace doctors, but they can greatly assist in faster and more accurate medical diagnosis."**
