ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/uvicorn"]
CMD ["main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "5", "--timeout-graceful-shutdown", "10"]
