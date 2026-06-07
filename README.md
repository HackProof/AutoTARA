# AutoTARA

<div align="center">
  <img src="images/autotara-logo.png" alt="AutoTARA Logo" width="300" />
  <h1>AutoTARA</h1>
  
  <div>
    <img src="https://img.shields.io/badge/vuejs-%2335495e.svg?style=for-the-badge&logo=vuedotjs&logoColor=%234FC08D" alt="Vue.js" />
    <img src="https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/bootstrap-%238511FA.svg?style=for-the-badge&logo=bootstrap&logoColor=white" alt="Bootstrap" />
    <img src="https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB" alt="Express.js" />
    <img src="https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  </div>
</div>

AutoTARA (Automated Threat Analysis and Risk Assessment) is a web-based framework that supports the ISO/SAE 21434 TARA process for the automotive industry. By integrating the MITRE TARA (CTSA/CRRA) methodology, Meta Attack Language (MAL), and LLMs, AutoTARA provides scalable and quantitative prioritization of security countermeasures.

## 📄 Publication

AutoTARA is a tool that implements the methodology proposed in the following paper, which is scheduled to be presented at **[VehicleSec'26 (4th USENIX Symposium on Vehicle Security and Privacy)](https://www.usenix.org/conference/vehiclesec26)**:

> **Bridging Two TARAs: Integrating MITRE CTSA/CRRA Prioritization into ISO/SAE 21434 for Automotive Security**  
> Minhyuk Park, Yejun Kim, and Seungjoo Kim  
> VehicleSec'26, August 10-11, 2026, Baltimore, MD, USA

## 🔍 Preview

### 🧩 Visual Threat Modeling
<div align="center">
  <img src="images/diagram-sample.png" alt="Threat Modeling" width="100%" />
</div>

### 🛡️ CTSA (Cyber Threat Susceptibility Analysis)
<div align="center">
  <img src="images/ctsa_sample.png" alt="CTSA" width="100%" />
</div>

### 📊 CRRA (Cyber Risk Remediation Assessment)
<div align="center">
  <img src="images/crra_sample.png" alt="CRRA" width="100%" />
</div>

## 🚀 Key Features

*   **Visual Threat Modeling:** Build and edit complex system diagrams using an intuitive graph editor powered by AntV X6.
*   **Detailed Property Management:** Configure specific properties for each component and connection within the system.
*   **Threat Management:** Systematically identify, categorize, and manage cybersecurity threats associated with system elements.
*   **Attack Simulation:** Simulate potential attack paths to discover vulnerabilities and validate security assumptions.
*   **Risk Assessment Modules:** Built-in support for standardized assessment methodologies, including CTSA (Cyber Threat Susceptibility Analysis) and CRRA (Cyber Risk Remediation Assessment).
*   **TARA Results Dashboard:** Provides dashboards for generated attack paths, including damage/threat scenarios and attack paths.

## 🛠️ Technology Stack

This project is built on a modern full-stack architecture.

### Frontend
*   **Core Framework:** [Vue 3](https://vuejs.org/)
*   **Build Tool:** [Vite](https://vitejs.dev/)
*   **State Management:** [Pinia](https://pinia.vuejs.org/)
*   **Diagram Engine:** [AntV X6](https://x6.antv.vision/)
*   **UI Framework:** [Bootstrap 5](https://getbootstrap.com/) and [FontAwesome](https://fontawesome.com/)

### Backend
*   **Runtime:** Node.js
*   **Framework:** [Express.js](https://expressjs.com/) (v5)
*   **Architecture:** Layered architecture (Controllers, Services, Repositories)

### Database
*   **Database:** PostgreSQL 17
*   **Containerization:** Docker and Docker Compose
*   **Driver:** [node-postgres (pg)](https://node-postgres.com/)

## 📦 Project Setup

### Prerequisites

*   **Node.js** (v20.19.0 or later recommended)
*   **npm**
*   **Docker Desktop** or **Docker Engine + Docker Compose**

### Installation and Running

This project consists of four services:

*   **db**: PostgreSQL 17
*   **mal-simulator**: FastAPI-based MAL simulation server
*   **tara-server**: Node.js/Express backend
*   **tara-vue**: Vue 3 + Vite frontend

The recommended way to run the full stack is to use the root `docker-compose.yml`.

#### 1. Start All Services with Docker Compose

```sh
docker compose up -d --build
```

This starts:

*   Frontend: `http://localhost:8080`
*   Backend API: `http://localhost:3000/api`
*   MAL Simulator API: `http://localhost:8000`
*   PostgreSQL: `localhost:5432`

#### 2. Stop Services

```sh
docker compose down
```

#### 3. Backend Environment Variables

The backend service loads environment variables from `tara.server/.env`, including Gemini-related settings.

Database and simulator connection values are overridden by Docker Compose so that containers can communicate over the internal Docker network.

#### 4. Optional Local Development

If needed, you can still run each service individually without Docker.

Database only:

```sh
cd db
docker compose up -d
```

Backend:

```sh
cd tara.server
npm clean-install
npm run dev
```

Frontend:

```sh
cd tara.vue
npm clean-install
npm run dev
```

MAL simulator:

```sh
cd mal-simulator.server
pip install -r requirements.txt
python api_server.py
```

## 🐳 Docker Information

The full stack is managed through the root `docker-compose.yml`.

*   **Database User:** `user`
*   **Database Name:** `tara_db`
*   **Database Volume:** `pgdata`
*   **Database Init Scripts:** `db/init`
*   **MITRE Data Files:** `db/data`

## 👏 Acknowledgements

This project incorporates code and concepts from **[OWASP Threat Dragon](https://github.com/OWASP/threat-dragon)**.
We thank the OWASP community for its significant contributions to open-source threat modeling tools.
Threat Dragon is licensed under the [Apache License 2.0](https://github.com/OWASP/threat-dragon/blob/main/LICENSE).