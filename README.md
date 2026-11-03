# FM27 Adjoint

Assistant personnel Windows pour Football Manager. Captures, conseils en français, comparaison de joueurs, historique et mises à jour au démarrage.

## Installer une fois

[Télécharger INSTALLER.bat](https://github.com/nonorigon-design/fm27-adjoint/raw/refs/heads/main/INSTALLER.bat)

Enregistre le fichier puis double-clique dessus. Il télécharge l'application dans `%LOCALAPPDATA%\FM27_Adjoint\programme`, prépare Python/Pillow et crée le raccourci **FM27 Adjoint** sur le Bureau. Utilise ensuite ce raccourci. Windows 10/11 et Internet nécessaires pour l'installation ; winget est nécessaire seulement si Python manque.

Le lanceur vérifie les mises à jour à chaque ouverture. Sans connexion, la version déjà installée s'ouvre. Un échec du nouveau processus ramène à la précédente version. L'historique reste dans `%LOCALAPPDATA%\FM27_Adjoint\historique.sqlite`.

## Configurer l'IA

Ajoute ta propre clé Gemini dans l'application (projet sans facturation pour utiliser uniquement les quotas gratuits disponibles), ou installe Ollama avec un modèle visuel pour le mode local. Aucune clé n'est incluse ou publiée. Les captures ne sont envoyées au moteur qu'après clic sur le bouton d'analyse.

## Publier une correction

1. Modifier les sources.
2. `python -m unittest discover -s tests -v`
3. `python build_update.py 1.2.1` (adapter le numéro).
4. Publier ensemble les sources et `update.json` sur `main`.

L'actualisation automatique couvre app.py, core.py et capture.py. Une évolution du lanceur ou des dépendances peut nécessiter de relancer l'installateur. Les empreintes vérifient les fichiers du manifeste ; la confiance dans sa provenance repose sur HTTPS et le contrôle de ce dépôt.

Voir [le guide complet](LISEZ_MOI.md). Les tests incluent des appels Windows et IA simulés ; aucun test réel dans FM ou avec une clé Gemini n'a encore été effectué depuis cet environnement.
