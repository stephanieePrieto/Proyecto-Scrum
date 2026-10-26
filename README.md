# ScrumFlow

Plataforma web para gestionar proyectos Scrum/Kanban en equipo.

## Como correrlo (Node 18 o superior)
1. `npm install express pg jsonwebtoken bcryptjs dotenv cors socket.io`
2. Copia `.env.example` como `.env` y ajusta los valores.
3. Crea la base de datos en PostgreSQL y ejecuta `database/schema.sql` y despues `database/seed.sql`.
4. `npm run dev` y abre http://localhost:3000


