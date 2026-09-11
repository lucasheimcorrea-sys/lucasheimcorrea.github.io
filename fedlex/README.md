# Fedlex — RS 220 (Code des obligations)

Reproduction de l'interface de [fedlex.admin.ch](https://www.fedlex.admin.ch/eli/cc/27/317_321_377/fr)
sur la page du Code des obligations, avec un chatbot **Claude Haiku** branché sur la
barre de recherche en haut à droite.

Vous écrivez dans la barre de recherche ; la réponse s'affiche **à la place du texte
de l'art. 3 CO**, avec la même typographie et la même numérotation d'alinéas en
exposant (¹ ² ³) que les articles voisins. L'en-tête « Art. 3 » et la note marginale
restent en place : rien ne distingue la réponse du reste du document.

## Mise en route

La clé API n'est **pas** dans le code (le dépôt est public : toute clé publiée ici
serait immédiatement lisible par n'importe qui, et révoquée par Anthropic).
Elle s'enregistre une fois par navigateur, depuis la barre de recherche elle-même.

1. Ouvrir la page.
2. Taper dans la barre de recherche :

   ```
   clé sk-ant-api03-VOTRE_CLE
   ```

3. Valider. La clé est stockée dans le `localStorage` de l'appareil et n'est
   transmise qu'à `api.anthropic.com`. Elle ne transite par aucun autre serveur.

Une clé Anthropic valide commence par `sk-ant-api03-`. Elle se crée sur
<https://console.anthropic.com/settings/keys>.

## Commandes de la barre de recherche

| Saisie | Effet |
|---|---|
| *n'importe quelle question* | Envoie la question à Claude ; la réponse remplace le texte de l'art. 3 |
| `clé <votre-clé>` | Enregistre la clé API sur cet appareil |
| `/reset` | Efface le fil de discussion et restaure le vrai texte de l'art. 3 |
| `/oubli` | Supprime la clé enregistrée |
| `Échap` | Interrompt la réponse en cours et restaure le texte d'origine |

La conversation garde le fil (les 20 derniers tours) le temps de l'onglet :
fermer l'onglet repart de zéro.

## Détails techniques

- Site statique : aucune dépendance, aucune étape de compilation.
- Appel direct à l'API Messages depuis le navigateur, en flux (SSE), avec l'en-tête
  `anthropic-dangerous-direct-browser-access: true` — l'API renvoie bien
  `access-control-allow-origin: *` pour ce cas.
- Modèle : `claude-haiku-4-5`.
- Consigne système : réponses en texte brut, sans Markdown, en paragraphes courts,
  pour que le rendu reste conforme à la mise en page d'un article de loi.

### Fichiers

```
index.html          la page (structure Fedlex + texte des art. 1 à 10 CO)
assets/fedlex.css   les styles (couleurs relevées sur le site officiel)
assets/fedlex.js    la barre de recherche, l'appel à l'API, le rendu dans l'art. 3
```

## Publication sur GitHub Pages

Dans **Settings → Pages**, choisir la branche `main` et le dossier `/ (root)`.
Le site est alors servi sur `https://<utilisateur>.github.io/fedlex/`.

## Avertissement

Cette page n'est pas le site officiel de la Confédération suisse et n'a aucun
caractère officiel. C'est une reproduction d'interface à usage personnel. Le texte
des articles est reproduit à titre d'illustration : pour le droit en vigueur,
se référer à [fedlex.admin.ch](https://www.fedlex.admin.ch).
