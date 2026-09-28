<div align="center">

# WARHEX.IO

### Real-time multiplayer · Networking · Distributed game services

<p>
  <img src="https://img.shields.io/badge/Go-1.22+-111827?style=for-the-badge&logo=go&logoColor=00ADD8" />
  <img src="https://img.shields.io/badge/WebSocket-Real--time-111827?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Node.js-Services-111827?style=for-the-badge&logo=node.js&logoColor=5FA04E" />
  <img src="https://img.shields.io/badge/Supabase-Data-111827?style=for-the-badge&logo=supabase&logoColor=3ECF8E" />
</p>

**A full-stack real-time game system spanning browser client, game servers, authentication and service distribution.**

</div>

---

## ⚡ What this project demonstrates

| Area | Implementation |
|---|---|
| **Real-time** | WebSocket client/server communication |
| **Game server** | Go-based server and game-state components |
| **Client** | JavaScript + Webpack + browser workers |
| **Authentication** | Node.js + Express + Discord + Firebase Admin |
| **Distribution** | Server discovery and load-balancing services |
| **Infrastructure** | Nginx / reverse-proxy configuration |

---

## 🧩 Architecture

~~~text
                         ┌─────────────────┐
                         │  Browser Client  │
                         └────────┬────────┘
                                  │
                           WebSocket / API
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ Discovery / Load Balancer│
                    └────────────┬─────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
               Game Server   Game Server   Game Server
                    │            │            │
                    └────────────┼────────────┘
                                 │
                         Game state / data

        ┌──────────────────────┐
        │ Authentication Service│
        └──────────┬───────────┘
                   ├── Discord
                   └── Firebase Admin
~~~

The repository separates the browser client from the real-time server and supporting services, allowing the system to be deployed as multiple cooperating components.

---

## 🎮 Real-time gameplay

The Go server contains dedicated components for gameplay state including:

- health
- resources
- capacity
- population
- entities
- networking workers

The client contains a dedicated networking layer and Web Worker support for browser-side network processing.

---

## 🔐 Authentication & services

The authentication service is a Node.js application built around:

- Express
- Discord.js
- Firebase Admin
- Axios

The repository also includes discovery/load-balancing services for distributing players across game-server instances.

---

## 🛠️ Stack

**Game server**  
Go · Gorilla WebSocket · PostgreSQL driver · x/time

**Client**  
JavaScript · Webpack · SWC · Web Workers · Supabase JS

**Services**  
Node.js · Express · Discord.js · Firebase Admin

**Infrastructure**  
Nginx · Load balancing · Multi-server deployment

---

## 📁 Repository

~~~text
Warhex.io/
├── server/          # Real-time Go game server
├── client/          # Browser client
├── auth-server/     # Authentication service
├── loadbalancer/    # Server discovery / distribution
└── nginx_default    # Reverse proxy configuration
~~~

---

## 🚀 Development

### Game server

~~~bash
cd server
go run ./...
~~~

### Client

~~~bash
cd client
npm install
npm run build
~~~

The client also contains dedicated build modes for its obfuscation pipeline.

### Authentication

~~~bash
cd auth-server
npm install
npm start
~~~

Environment configuration is required for authentication integrations.

---

## 🧠 Engineering model

~~~text
REAL-TIME SYSTEMS
       ↓
NETWORKING
       ↓
GAME STATE
       ↓
DISTRIBUTED SERVICES
       ↓
AUTHENTICATION
       ↓
DEPLOYMENT
~~~

<div align="center">

**Client → Server → Services → Infrastructure**

</div>
