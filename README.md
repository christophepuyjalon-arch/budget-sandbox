# Budget : comptes et enveloppes sur vos téléphones

Budget récupère automatiquement les opérations de vos comptes bancaires (via Enable Banking) et les affiche sur vos téléphones :

- **Aujourd’hui** : reste à dépenser du mois, anneaux des dépenses courantes (le trait noir marque le rythme attendu à cette date), charges fixes, projets, solde disponible une fois les cartes à débit différé déduites.
- **Opérations** : liste du mois. Toucher une opération permet de la classer ; « toujours classer ainsi » crée une règle pour les suivantes.
- **Recherche** (en haut de l’onglet Opérations) : texte libre (libellé, commentaire, montant) et/ou catégorie, sur les 12 derniers mois, avec le total.
- **Graphiques** : dépenses par mois face au budget, une catégorie dans le temps, répartition du mois, évolution du solde.
- **Réglages** : budgets mensuels, projets (budget sur une période, rattachement automatique par motif), type de chaque compte (courant, carte à débit différé, épargne).

Le classement se fait sur le téléphone à partir de règles (une liste de départ de commerçants courants, puis les tiennes). Les dépenses rattachées à un projet ne comptent pas dans les budgets du mois. Les comptes d’épargne n’entrent pas dans le budget.

À venir : prévision du solde jusqu’à la fin du mois, bouton « Analyser avec Claude », alertes.

Chaque opération peut recevoir un commentaire, et « faire de même pour les opérations contenant… » l’applique automatiquement aux suivantes.

## Comment c’est organisé

Comme pour Forme, un petit serveur gratuit chez Cloudflare garde tes clés secrètes et interroge la banque 2 fois par jour, matin et soir (les banques autorisent 4 consultations par jour sans toi). Les données sont rangées dans une base Cloudflare D1.

```
src/index.js       le serveur : routes, synchronisation, données pour l’app
src/banque.js      le dialogue avec Enable Banking (signature, comptes, opérations)
src/acces.js       qui a le droit d’ouvrir l’app (activation, invitations)
src/schema.js      la structure de la base de données (créée automatiquement)
src/defauts.js     catégories, règles et projets de départ
public/            l’app (page, styles, icônes, mode hors ligne)
wrangler.toml      la configuration Cloudflare
```

**Pas de mot de passe.** Chaque téléphone est activé une seule fois, puis il reste reconnu. Toi, tu actives le tien avec le code d’installation. Ensuite, tu invites les autres depuis Réglages avec un QR code ou un lien.

## Ce qu’il te faut

Rien à installer sur ton ordinateur : tout se fait dans le navigateur.

- Ton **compte Cloudflare** (le même que pour Forme), relié à GitHub.
- Ton application **Enable Banking** : son identifiant (déjà dans `wrangler.toml`) et le fichier `.pem` de sa clé privée.

## Installation (une seule fois, environ 15 minutes)

**1. Créer la base de données**

Sur dash.cloudflare.com : **Stockage et bases de données**, puis **D1**, puis **Créer une base de données**. Nomme-la `budget` et valide. Son **ID** (Database ID) est déjà dans `wrangler.toml` ; si tu recrées la base un jour, remplace-le (sur github.com : ouvre le fichier, crayon ✎, puis « Commit changes »). Cet ID n’est pas secret. Les tables se créent toutes seules au premier lancement.

**2. Brancher le dépôt GitHub**

**Workers et Pages**, puis **Créer**, puis **Importer un dépôt** (Import a repository). Choisis `budget-sandbox`.
- Nom du projet : `budget` (le même que dans `wrangler.toml`).
- Commande de déploiement : laisse `npx wrangler deploy`.

Valide. Cloudflare publie l’app, puis la republie à chaque modification sur GitHub.

**3. Enregistrer les deux secrets**

Dans le Worker `budget` : **Paramètres**, puis **Variables et secrets**, puis **Ajouter**. Choisis le type **Secret** pour les deux.
- `EB_PRIVATE_KEY` : ouvre le fichier `.pem` avec le Bloc-notes (clic droit, Ouvrir avec), sélectionne tout et colle-le. Les retours à la ligne peuvent disparaître, l’app le gère.
- `CODE_INSTALLATION` : invente une longue phrase de passe (au moins 20 caractères). Elle sert seulement à activer un téléphone **administrateur** : le tien. Garde-la dans ton gestionnaire de mots de passe.

**4. Déclarer l’adresse chez Enable Banking**

L’adresse de l’app s’affiche en haut du Worker, du type `https://budget.ton-compte.workers.dev`. Dans le Control Panel Enable Banking, ajoute à ton application la Redirect URL :
```
https://budget.ton-compte.workers.dev/callback
```
(avec ta vraie adresse). Elle doit être identique au caractère près.

## Sur ton téléphone (Android)

1. Ouvre l’adresse dans **Chrome**.
2. Saisis le code d’installation et ton prénom, puis **Activer**.
3. Touche **Installer l’application** (ou menu ⋮, puis « Installer l’application »).
4. Dans **Réglages**, puis **Connecter une banque** : choisis ta banque et donne ton accord sur son site. Tu reviens ensuite dans l’app avec tes comptes.

## Premiers réglages après la connexion de la banque

1. **Réglages, puis Comptes** : indique pour chaque carte « Carte à débit différé » (débitée le 4), et « Épargne » pour les livrets.
2. **Réglages, puis Budgets du mois** et **Projets** : vérifie les montants préremplis.
3. **Opérations, puis À classer** : classe ce qui reste. Coche « toujours classer ainsi » pour que l’app s’en souvienne.

## Inviter ta femme (iPhone)

1. Sur ton téléphone : **Réglages**, puis **Famille**. Tape son prénom, puis **Inviter**.
2. Elle scanne le QR code avec l’**appareil photo** de son iPhone. Le lien s’ouvre dans Safari.
3. Elle touche **Activer ce téléphone**, puis suit les 3 étapes affichées pour mettre Budget sur l’écran d’accueil.

L’invitation reste valable 48 heures. Si l’app installée lui redemande un code, elle saisit le code de secours affiché sous le QR code. Si elle change de téléphone, refais une invitation. Pour couper un accès : Réglages, Famille, **Retirer**.

## Entretien

- **Autorisation bancaire expirée** (tous les 90 à 180 jours, selon la banque) : l’app affiche un bandeau. Touche **Renouveler** et redonne ton accord sur le site de la banque. L’historique est conservé.
- **Voir ce qui se passe sur le serveur** : dans le Worker `budget`, onglet **Journaux** (Logs), puis **Commencer** (Begin log stream), puis touche le bouton de synchronisation dans l’app.
- **Modifier le code** : chaque modification sur GitHub est republiée automatiquement par Cloudflare (onglet **Déploiements** pour suivre).
- **Tester sur un ordinateur** (facultatif, pour un développeur) : copie `.dev.vars.example` en `.dev.vars`, remplis-le, puis `npm install` et `npm run dev`. L’app tourne alors sur `https://localhost:8787`.

## Limites connues

- Les opérations arrivent avec le délai de la banque : 2 synchros automatiques par jour, plus le bouton de synchronisation quand tu ouvres l’app.
- Le code Enable Banking a été écrit sans pouvoir consulter leur documentation en direct, puis testé contre une imitation de leur service. Le premier essai sur le sandbox réel peut révéler un nom de champ différent : les Journaux du Worker affichent alors la réponse exacte de leur serveur.
- À la première connexion, l’app demande 1 an d’historique. Si la banque refuse, elle se contente de 89 jours.
