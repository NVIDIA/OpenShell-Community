# ECS Deployment Example

Run the Kiro sandbox as a headless HTTP service on AWS ECS Fargate.

## Architecture

The ECS variant wraps Kiro CLI in a lightweight Python HTTP server (`server.py`)
that accepts prompts via POST and returns clean JSON responses. The API key is
injected from AWS Secrets Manager at task startup.

```
Client → POST :8080 {"command": "..."} → Kiro CLI → JSON response
```

## Prerequisites

- AWS account with ECS, ECR, and Secrets Manager access
- Kiro API key stored in Secrets Manager

## Setup

### 1. Store your API key

```bash
aws secretsmanager create-secret \\
  --name kiro-sandbox/api-key \\
  --secret-string "<your-kiro-api-key>" \\
  --region us-east-1
```

### 2. Create ECR repository

```bash
aws ecr create-repository --repository-name kiro-sandbox --region us-east-1
```

### 3. Build and push

```bash
# From the sandboxes/kiro/ directory
docker build -f examples/ecs/Dockerfile.ecs -t kiro-sandbox-ecs .
docker tag kiro-sandbox-ecs:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/kiro-sandbox:latest

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/kiro-sandbox:latest
```

### 4. Deploy

Edit `task-definition.json` — replace `ACCOUNT_ID` and `REGION` with your values.

```bash
aws ecs create-cluster --cluster-name kiro-sandbox --region us-east-1

aws ecs register-task-definition --cli-input-json file://task-definition.json --region us-east-1

aws ecs run-task \\
  --cluster kiro-sandbox \\
  --task-definition kiro-sandbox \\
  --launch-type FARGATE \\
  --network-configuration 'awsvpcConfiguration={subnets=["subnet-xxx"],securityGroups=["sg-xxx"],assignPublicIp=ENABLED}' \\
  --region us-east-1
```

### 5. Use

```bash
# Health check
curl http://<TASK_IP>:8080/health

# Send a prompt
curl -X POST http://<TASK_IP>:8080 \\
  -H "Content-Type: application/json" \\
  -d '{"command": "write a python function to reverse a string"}'
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns `{"status": "healthy"}` |
| `/` | GET | Returns usage info |
| `/` | POST | Accepts `{"command": "..."}`, returns `{"response": "...", "exit_code": 0}` |

## Security Notes

- The API key is injected via Secrets Manager — never baked into the image
- The security group should restrict inbound 8080 to trusted CIDRs
- For production, add an ALB with TLS termination in front of the task
