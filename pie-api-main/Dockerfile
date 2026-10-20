# Base Image
# 3.13+: ssl's TLS-PSK callbacks, used by the device port (app/device_tls_server.py)
FROM python:3.13

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
# Plain HTTP: TLS is terminated by Caddy (docker-compose.yml, Caddyfile).
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]

