# Dynamic K8s Project Routing with Caddy & Cloudflare

Complete guide to deploy unlimited projects with dynamic HTTPS routing on Kubernetes.

---

## Architecture Overview

```
User Request: proj1.projects.yourdomain.com
    ↓
Cloudflare DNS (*.projects.yourdomain.com → YOUR_LOADBALANCER_IP)
    ↓
LoadBalancer
    ↓
Caddy (wildcard HTTPS cert)
    ↓
Service: proj1
    ↓
Pod: React dev server (port 5173)
```

**Result:** Any subdomain like `anything.projects.yourdomain.com` automatically routes to service `anything:80`

---

## Prerequisites

- Kubernetes cluster (Civo K3s or any K8s provider)
- Domain name
- Cloudflare account (free)
- Docker Hub account

---

## Part 1: Kubernetes Cluster Setup

### Cluster Info
```
Type: K3s (or any Kubernetes)
Nodes: 3+ worker nodes recommended
Get your LoadBalancer IP from: kubectl get svc gateway
```

### Verify Cluster
```bash
kubectl get nodes
# Should show nodes in Ready state
```

---

## Part 2: Domain & DNS Setup

### Transfer Domain to Cloudflare

1. **Sign up:** https://dash.cloudflare.com/sign-up (free)
2. **Add site:** Enter your domain (e.g., `yourdomain.com`)
3. **Update nameservers at your registrar:**
   - Get Cloudflare nameservers (e.g., `alex.ns.cloudflare.com`)
   - Update in your domain registrar's dashboard → Nameservers → Custom DNS
   - Wait 5-30 minutes for activation

### Add DNS Records

In Cloudflare → yourdomain.com → DNS → Records:

```
Type: A
Name: *.projects
IPv4: YOUR_LOADBALANCER_IP
Proxy: OFF (gray cloud)

Type: A
Name: k8
IPv4: YOUR_LOADBALANCER_IP
Proxy: OFF (gray cloud)
```

**Critical:** Proxy must be OFF (DNS only)

### Verify DNS
```bash
nslookup proj1.projects.yourdomain.com
# Should return: YOUR_LOADBALANCER_IP
```

---

## Part 3: Cloudflare API Token

### Create Token

Cloudflare → Profile → API Tokens → Create Token

**Template:** Edit zone DNS

**Settings:**
- Permissions: Zone → DNS → Edit
- Zone Resources: Include → Specific zone → yourdomain.com
- Client IP Filtering: Add your cluster's external IP (find via `kubectl get nodes -o wide`)

**Save the token!** (starts with a long string)

### Add to Kubernetes
```bash
kubectl create secret generic cloudflare-api-token \
  --from-literal=token=YOUR_CLOUDFLARE_TOKEN_HERE
```

---

## Part 4: Build Custom Caddy Image

Caddy needs Cloudflare DNS plugin for wildcard certs.

### Dockerfile
```dockerfile
FROM caddy:2.8-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.8-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### Build & Push
```bash
# Build
docker build -f Dockerfile.caddy -t caddy-cloudflare:latest .

# Tag for Docker Hub (replace username)
docker tag caddy-cloudflare:latest YOUR_USERNAME/caddy-cloudflare:latest

# Push
docker login
docker push YOUR_USERNAME/caddy-cloudflare:latest
```

---

## Part 5: Deploy Caddy Gateway

### Caddyfile ConfigMap

`caddyfile.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: caddyfile
data:
  Caddyfile: |
    {
      email your-email@example.com
    }

    https://*.projects.yourdomain.com {
      tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
      }
      reverse_proxy {http.request.host.labels.3}:80
    }

    http://*.projects.yourdomain.com {
      redir https://{host}{uri} permanent
    }

    https://k8.yourdomain.com {
      respond "🚀 Gateway UP!" 200
    }

    http://k8.yourdomain.com {
      redir https://{host}{uri} permanent
    }
```

**Key points:**
- `{http.request.host.labels.3}` extracts subdomain (labels indexed from right)
- `dns cloudflare` enables DNS-01 challenge for wildcard cert
- Auto-redirects HTTP to HTTPS

### Caddy Deployment

`caddy-deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: caddy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: caddy
  template:
    metadata:
      labels:
        app: caddy
    spec:
      containers:
      - name: caddy
        image: YOUR_USERNAME/caddy-cloudflare:latest
        ports:
        - containerPort: 80
        - containerPort: 443
        env:
        - name: CLOUDFLARE_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: cloudflare-api-token
              key: token
        volumeMounts:
        - name: config
          mountPath: /etc/caddy
      volumes:
      - name: config
        configMap:
          name: caddyfile
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
spec:
  type: LoadBalancer
  selector:
    app: caddy
  ports:
  - name: http
    port: 80
    targetPort: 80
  - name: https
    port: 443
    targetPort: 443
```

### Deploy
```bash
kubectl apply -f caddyfile.yaml
kubectl apply -f caddy-deployment.yaml

# Watch logs
kubectl logs -f $(kubectl get pod -l app=caddy -o name)

# Look for:
# "certificate obtained successfully","identifier":"*.projects.samosa.wtf"
```

---

## Part 6: Deploy Projects

### Project Structure

Each project needs:
1. **Deployment:** Runs the dev server
2. **Service:** Exposes it internally with name matching subdomain

### Example: Project "proj1"

`proj1.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: proj1
spec:
  replicas: 1
  selector:
    matchLabels:
      project: proj1
  template:
    metadata:
      labels:
        project: proj1
    spec:
      containers:
      - name: dev-server
        image: node:18-alpine
        ports:
        - containerPort: 5173
        command: ['/bin/sh', '-c']
        args:
          - |
            apk add --no-cache git &&
            git clone https://github.com/YOUR_REPO /app &&
            cd /app &&
            cat > vite.config.js << 'EOF'
            import { defineConfig } from 'vite'
            import react from '@vitejs/plugin-react'
            export default defineConfig({
              plugins: [react()],
              server: {
                host: '0.0.0.0',
                port: 5173,
                strictPort: true,
                allowedHosts: true
              }
            })
            EOF
            npm install &&
            npm run dev
---
apiVersion: v1
kind: Service
metadata:
  name: proj1
spec:
  selector:
    project: proj1
  ports:
  - port: 80
    targetPort: 5173
```

**Critical:** Service name MUST match subdomain (e.g., `proj1` for `proj1.projects.samosa.wtf`)

### Deploy
```bash
kubectl apply -f proj1.yaml

# Wait for npm install
kubectl logs -f $(kubectl get pod -l project=proj1 -o name)

# Access at: https://proj1.projects.samosa.wtf
```

---

## How Dynamic Routing Works

### Request Flow

1. **User visits:** `proj1.projects.yourdomain.com`
2. **DNS resolves:** LoadBalancer IP
3. **LoadBalancer forwards to:** Caddy pod
4. **Caddy extracts subdomain:** `proj1` from `{http.request.host.labels.3}`
5. **Caddy proxies to:** `proj1:80` (Kubernetes service DNS)
6. **Service routes to:** Pod on port 5173
7. **Pod responds:** React dev server content

### Label Indexing

For hostname: `proj1.projects.yourdomain.com`
```
labels.0 = com
labels.1 = yourdomain
labels.2 = projects
labels.3 = proj1  ← We use this!
```

Labels are indexed from RIGHT to LEFT.

---

## Testing

### Test Gateway
```bash
curl https://k8.yourdomain.com
# Should return: "🚀 Gateway UP!"
```

### Test Project
```bash
curl https://proj1.projects.yourdomain.com
# Should return: React HTML
```

### Test New Project
```bash
# Deploy proj2.yaml with service name "proj2"
kubectl apply -f proj2.yaml

# Immediately accessible at:
curl https://proj2.projects.yourdomain.com
```

No Caddyfile updates needed!

---

## Debugging

### Check Caddy Logs
```bash
kubectl logs -f $(kubectl get pod -l app=caddy -o name)
```

**Look for:**
- `certificate obtained successfully` - SSL working
- `dial tcp: lookup` errors - Service name mismatch
- `403` errors - Cloudflare token IP restrictions

### Check Pod Status
```bash
kubectl get pods
kubectl logs POD_NAME
kubectl describe pod POD_NAME
```

### Check DNS
```bash
nslookup proj1.projects.yourdomain.com
# Should return: YOUR_LOADBALANCER_IP
```

### Test from Inside Cluster
```bash
kubectl run test --rm -it --image=alpine --restart=Never -- sh
apk add curl
curl http://proj1:80  # Test service directly
```

---

## Common Issues

### SSL Error (35)
**Cause:** Certificate not obtained yet  
**Fix:** Wait 30 seconds after first request, check Caddy logs

### DNS Not Resolving
**Cause:** Cloudflare DNS not set up  
**Fix:** Add `*.projects` A record, disable proxy (gray cloud)

### 502 Bad Gateway
**Cause:** Service name doesn't match subdomain  
**Fix:** Ensure service name is `proj1` for `proj1.projects.yourdomain.com`

### 403 Cloudflare Error
**Cause:** API token IP restrictions  
**Fix:** Add cluster IP or allow all IPs (0.0.0.0/0) in token settings

---

## File Structure

```
k8s/
├── caddyfile.yaml              # Routing configuration
├── caddy-deployment.yaml       # Caddy gateway
├── proj1.yaml                  # Example project 1
├── proj2.yaml                  # Example project 2
└── Dockerfile.caddy            # Custom Caddy image
```

---

## Quick Deploy New Project

```bash
# 1. Create project YAML (replace proj3 with your subdomain)
cat > proj3.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: proj3
spec:
  replicas: 1
  selector:
    matchLabels:
      project: proj3
  template:
    metadata:
      labels:
        project: proj3
    spec:
      containers:
      - name: dev-server
        image: node:18-alpine
        ports:
        - containerPort: 5173
        command: ['/bin/sh', '-c']
        args:
          - |
            apk add git && \
            git clone YOUR_REPO /app && \
            cd /app && \
            npm install && \
            npm run dev -- --host 0.0.0.0
---
apiVersion: v1
kind: Service
metadata:
  name: proj3
spec:
  selector:
    project: proj3
  ports:
  - port: 80
    targetPort: 5173
EOF

# 2. Deploy
kubectl apply -f proj3.yaml

# 3. Access immediately
curl https://proj3.projects.yourdomain.com
```

**That's it!** No Caddy restarts, no DNS changes needed.

---

## Production Tips

1. **Resource Limits:** Add CPU/memory limits to deployments
2. **Monitoring:** Use `kubectl top` to monitor resource usage
3. **Cert Renewal:** Caddy auto-renews, check logs monthly
4. **Backups:** Export K8s configs regularly
5. **Rate Limits:** Let's Encrypt has cert limits (50/week)

---

## Cost Breakdown

- K8s cluster: ~$20-40/month (varies by provider)
- LoadBalancer: Included in cluster
- Domain: ~$10-15/year
- Cloudflare: Free
- SSL certs: Free (Let's Encrypt)

**Total:** ~$20-40/month for unlimited projects

---

## Summary

You've built a production-ready dynamic routing system where:

✅ Any subdomain automatically routes to matching K8s service  
✅ Wildcard HTTPS cert covers all projects  
✅ No manual Caddy updates needed  
✅ Deploy new project in 2 minutes  
✅ Professional URLs: `yourapp.projects.yourdomain.com`

Built with: Kubernetes + Caddy + Cloudflare DNS + Let's Encrypt