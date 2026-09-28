# Warhex.io

Real-time multiplayer game engineering project focused on browser gameplay, networking and distributed game services.

## Overview

Warhex.io is organized as a multi-service multiplayer game stack:

- browser client
- real-time Go game server
- authentication service
- server discovery / load balancing
- persistent data integration
- production-oriented reverse proxy configuration

The repository brings together real-time networking, game state, browser workers, authentication and service orchestration in one codebase.

## Architecture

~~~
Browser Client
     │
     ├── WebSocket / real-time communication
     │
     ▼
Server Discovery / Load Balancer
     │
     ├── Game Server 1
     ├── Game Server 2
     └── Game Server N
     
Authentication Service
     │
     ├── Discord integration
     └── Firebase Admin

Game Server
     │
     ├── Game state
     ├── Units / entities
     ├── Resources
     ├── Capacity / population
     └── Network workers
~~~

## Key engineering areas

### Real-time gameplay

The server is implemented in Go and uses WebSocket communication for real-time client/server interaction.

### Game state

The server contains dedicated components for gameplay state such as health, resources, capacity, population and entities.

### Client networking

The browser client includes a dedicated networking layer and Web Worker support for handling network-related work.

### Authentication

The authentication service is a Node.js application using Express, Discord integration and Firebase Admin.

### Service distribution

The project includes server discovery and load-balancing components for routing players across game-server instances.

## Technology

**Game server**
- Go
- Gorilla WebSocket
- PostgreSQL driver
- golang.org/x/time

**Client**
- JavaScript
- Webpack
- SWC
- Web Workers
- Supabase JavaScript client

**Authentication**
- Node.js
- Express
- Discord.js
- Firebase Admin
- Axios

**Infrastructure**
- Nginx
- Load balancing
- Multiple game-server instances

## Repository structure

~~~
Warhex.io/
├── server/          # Go real-time game server
├── client/          # Browser client
├── auth-server/     # Authentication service
├── loadbalancer/    # Server discovery / traffic distribution
└── nginx_default    # Reverse proxy configuration
~~~

## Local development

### Game server

~~~
cd server
go run ./...
~~~

### Client

~~~
cd client
npm install
npm run build
~~~

The client also provides dedicated build modes for its obfuscation pipeline.

### Authentication service

~~~
cd auth-server
npm install
npm start
~~~

Environment configuration is required for the authentication integrations.

## Engineering focus

~~~
real-time systems
      ↓
networking
      ↓
game state
      ↓
distributed services
      ↓
authentication
      ↓
deployment
~~~

This project represents hands-on work across the lifecycle of a real-time web application: client, server, networking, authentication and service infrastructure.
