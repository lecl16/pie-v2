# Base Image
FROM python:3.11

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose port for FastAPI
EXPOSE 8000

# Run FastAPI
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

