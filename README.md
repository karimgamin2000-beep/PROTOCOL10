# PROTOCOL 10 ☢️

**PROTOCOL 10** est un jeu web multijoueur d'extraction en vue objective (TPS) et de déduction sociale, conçu pour 10 joueurs. Plongés dans un univers post-apocalyptique et radioactif, les survivants doivent collaborer pour ravitailler leur bunker tout en démasquant les traîtres infiltrés qui tentent de saboter l'opération.

Inspiré par des mécaniques de *Lethal Company* et *Among Us*, le projet est développé avec une approche **Product-Driven** et **Minimaliste** (*Vibe-Coding* / *Solo-Founder*) : aucun framework lourd, uniquement du code performant, ultra-rapide à charger et facilement refactorisable.

---

## 🎮 Concept & Boucle de Gameplay

Une partie se déroule en **3 manches maximum** avec la répartition suivante : **8 Innocents** contre **2 Infiltrés** (qui se reconnaissent entre eux).

### Chaque manche suit 3 phases chronométrées :
1. **L'Extraction (1m25s) :** Les joueurs sortent du bunker sécurisé pour fouiller une ville en 3D à la recherche de ressources. C'est le moment idéal pour les Infiltrés pour éliminer discrètement des Innocents isolés dans les angles morts.
2. **La Tempête de Radiations :** Une alarme retentit. Un brouillard radioactif mortel (dégâts continus, visibilité réduite) envahit la carte. C'est une course contre la montre : il faut sprinter et atteindre le Bunker avant la fermeture définitive des portes blindées.
3. **La Table des Votes :** De retour au chaud (ou pas), un conseil de déduction s'ouvre via l'interface de chat/vocal. Les joueurs débattent des comportements suspects. La majorité élimine un joueur en le jetant définitivement dans les radiations. Son véritable rôle est alors révélé.

### Conditions de Victoire :
*   **Innocents :** Éliminer les 2 Infiltrés par le vote **OU** atteindre le quota de ressources en survivant à toutes les manches.
*   **Infiltrés :** Éliminer tous les Innocents **OU** les bloquer dehors pendant la tempête **OU** garder au moins un Infiltré en vie à la fin de la dernière manche.

---

## 🛠️ Stack Technique

L'architecture est pensée pour un déploiement instantané, des tests en temps réel sans compilation lourde et une séparation stricte des composants.

*   **Frontend (Client) :** 
    *   `TypeScript` + `HTML5 / CSS3` natif (pas de surcouche type React/Vue).
    *   `Three.js` pour le rendu 3D, la caméra TPS, la gestion du brouillard et les déplacements.
    *   Design épuré et moderne en **Noir & Blanc** style industriel/militaire.
    *   Déploiement mondial ultra-rapide sur **Vercel**.
*   **Backend (Serveur de Jeu) :** 
    *   `Node.js` (ou `Bun`) en `TypeScript`.
    *   `Socket.io` pour la machine à états synchrone (matchmaking, timers, votes, inventaire).
    *   `Geckos.io` (WebSockets légers / UDP via WebRTC) pour la synchronisation fluide des mouvements en temps réel à 20Hz.
    *   Hébergement persistant H24 sur **Railway**.

---

## 🎨 Identité Visuelle

*   **Atmosphère :** Brutaliste, minimaliste, bunker militaire et fin du monde.
*   **Charte Graphique :** Palette strictement Noir & Blanc moderne.
*   **Logo :** Un sas de bunker circulaire fusionné avec une mire tactique, brisé par une ligne diagonale (symbole du sabotage).

---

## 🚀 Architecture du Code

Le projet utilise un typage strict et partagé pour garantir qu'aucune désynchronisation n'ait lieu entre le client et le serveur :

```text
├── shared/
│   └── types.ts          # Source unique de vérité (Événements réseau, GameState)
├── server/
│   └── server.ts         # Serveur autoritaire (Boucle de jeu, Gestion des salons)
└── client/
    ├── index.html        # UI épurée et canvas de jeu
    ├── game.ts           # Logique de rendu 3D (Three.js)
    └── network.ts        # Client réseau et réconciliation des positions
