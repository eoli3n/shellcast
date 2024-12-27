import { AnsiUp } from './ansi_up.js'
const ansiUp = new AnsiUp();
ansiUp.use_classes = true; // Active l'utilisation des classes CSS pour les couleurs ANSI

// Cache des regex pour optimiser les recherches
const regexCache = new Map()

// Buffer pour stocker les lignes à afficher
const lineBuffer = []
let isProcessing = false
let finishedProcessing = false  // Indicateur pour signaler la fin du processus de traitement

// Fonction de mise en cache des expressions régulières pour une utilisation répétée
const getRegex = (pattern) => {
    if (!regexCache.has(pattern)) {
        regexCache.set(pattern, new RegExp(pattern)) // Cache la regex pour la réutiliser
    }
    return regexCache.get(pattern)
}

// Fonction d'autoscroll optimisée avec requestAnimationFrame
let scrollTimeout
const smartScroll = () => {
    if (scrollTimeout) return // Ne pas exécuter si un autre scroll est déjà en cours
    
    // Demande un rafraîchissement du scroll lorsque l'animation est prête
    scrollTimeout = requestAnimationFrame(() => {
        const html = document.documentElement
        html.scrollTop = html.scrollHeight // Fait défiler jusqu'en bas
        scrollTimeout = null
    })
}

// Connexion au serveur via WebSocket
const locationSub = window.location.origin + window.location.search
const socket = io.connect(locationSub, {
    path: '/' + window.location.pathname.split('/')[1] + '/socket.io', // Ajuste le chemin du WebSocket
    transports: ['websocket'],
    upgrade: false // Désactive la mise à niveau du transport (pour forcer le WebSocket)
})

let jsonHighlight = []  // Tableau pour les configurations de surlignage

// Initialisation de la connexion et envoi des événements initiaux
socket.emit('init', window.location.pathname)
socket.emit('focus')

// Réception des configurations de surlignage depuis le serveur
socket.on('highlight', (data) => {
    jsonHighlight = data || [] // Sauvegarde des données de surlignage
    jsonHighlight.forEach(hl => {
        if (hl.word) getRegex(hl.word)  // Cache les regex pour chaque mot à surligner
        if (hl.line) getRegex(hl.line)  // Cache les regex pour chaque ligne à surligner
    })
    
    socket.emit('run') // Lance le traitement sur le serveur
})

// Fonction pour créer un élément <span> avec un mot donné
const createSpan = (word) => {
    const span = document.createElement('span');
    span.textContent = word; // Définit le contenu du span
    return span;
};

// Appliquer les surlignages sur le texte
const applyHighlights = (element, text, isLine = false) => {
    if (!jsonHighlight || jsonHighlight.length === 0) return; // Si pas de surlignages définis, ne rien faire

    if (isLine) {
        // Surlignage spécifique pour les lignes
        for (const hl of jsonHighlight) {
            if (hl.line && new RegExp(hl.line).test(text)) {
                // Appliquer le surlignage pour la ligne
                const contentNodes = Array.from(element.childNodes).filter(node =>
                    node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'A')
                );

                contentNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const span = document.createElement('span');
                        span.className = hl.class; // Appliquer la classe CSS de surlignage
                        span.textContent = node.textContent;
                        node.replaceWith(span);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        node.classList.add(hl.class); // Ajouter la classe sur l'élément
                    }
                });
                return; // Arrêter après le premier surlignage trouvé
            }
        }
        return; // Si aucune règle de ligne n'a été trouvée
    }

    // Surlignage des mots dans le texte
    if (!isLine) {
        const nodes = Array.from(element.childNodes);
        element.innerHTML = ''; // Vider l'élément pour le reconstruire avec les spans

        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                const words = node.textContent.split(/(\s+)/); // Séparer le texte en mots tout en gardant les espaces
                words.forEach(word => {
                    if (word.trim().length === 0) { 
                        element.appendChild(document.createTextNode(word)); // Ajouter directement les espaces
                        return;
                    }
                    const span = document.createElement('span');
                    span.textContent = word;

                    // Vérifier chaque mot pour appliquer un surlignage si nécessaire
                    for (const hl of jsonHighlight) {
                        if (hl.word && getRegex(hl.word).test(word)) {
                            // Si des classes sont déjà présentes (comme ansi-*), les ajouter sans les supprimer
                            if (span.classList.length > 0) {
                                span.classList.add(hl.class); // Ajouter la classe de surlignage
                            } else {
                                span.classList.add(hl.class); // Ajouter la classe de surlignage si aucune autre classe n'est présente
                            }
                        }
                    }
                    element.appendChild(span); // Ajouter le mot à l'élément
                });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Pour les éléments avec des classes existantes, préserver les classes ansi- et ajouter des classes de surlignage supplémentaires
                const clonedNode = node.cloneNode(true); // Cloner le noeud
                jsonHighlight.forEach(hl => {
                    if (hl.word && new RegExp(hl.word).test(node.textContent)) {
                        clonedNode.classList.add(hl.class); // Ajouter la classe de surlignage au node
                    }
                });
                element.appendChild(clonedNode); // Ajouter l'élément cloné à l'élément principal
            }
        });
    }
};


// Créer un élément de ligne avec son contenu
const createLine = (data) => {
  const lineDiv = document.createElement('div');
  lineDiv.className = 'log-line';  // Appliquer une classe pour les lignes de log

  // Lien pour afficher les id de ligne
  const link = document.createElement('a');
  lineDiv.appendChild(link);

  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = ansiUp.ansi_to_html(data); // Convertir le texte ANSI en HTML

  applyHighlights(contentDiv, data, false); // Appliquer les surlignages de mots dans la ligne

  lineDiv.appendChild(contentDiv);

  applyHighlights(lineDiv, data, true); // Appliquer les surlignages de ligne après le texte

  return lineDiv;
};

// Taille du buffer de lignes à traiter
let batchSize = 1; // Taille de traitement initiale
let lastProcessTime = 0;
let smoothedProcessTime;
const smoothingFactor = 0.02;
let linesProcessed = 0;
const MAX_BATCH_SIZE = 5000; // Limite de taille pour éviter de trop grands lots
let startTime;

// Fonction pour traiter les lignes de manière optimisée
const processLines = () => {
    if (isProcessing) return; // Si déjà en train de traiter, ne pas démarrer un autre traitement
    isProcessing = true;

    const processNextLines = () => {
        if (lineBuffer.length === 0) {
            if (finishedProcessing) {
                // Si le traitement est terminé et qu'il y a des lignes vides, les supprimer
                if (lineBuffer[lineBuffer.length - 1]?.trim() === '' && 
                    lineBuffer[lineBuffer.length - 2]?.trim() === '') {
                    lineBuffer.pop();
                    lineBuffer.pop();
                }
            }
            isProcessing = false;
            return;
        }

        const linesToProcess = lineBuffer.splice(0, batchSize); // Prendre un lot de lignes à traiter
        const fragment = document.createDocumentFragment();

        linesToProcess.forEach((line) => {
            if (line.trim().length === 0) return;
            const lineDiv = createLine(line.trim());  // Créer un élément pour la ligne
            fragment.appendChild(lineDiv);
        });

        document.getElementById('code').appendChild(fragment);
        smartScroll(); // Appliquer l'autoscroll

        const endTime = performance.now();
        const processTime = endTime - startTime;

        smoothedProcessTime = smoothedProcessTime * (1 - smoothingFactor) + processTime * smoothingFactor;

        // Ajuster la taille du lot pour éviter un traitement trop rapide ou trop lent
        if (smoothedProcessTime < 5) { 
            batchSize = Math.min(Math.round(batchSize * 2.5), MAX_BATCH_SIZE); 
        } else if (smoothedProcessTime > 25) { 
            batchSize = Math.max(Math.floor(batchSize / 2), 1);
        }

        linesProcessed += linesToProcess.length;
        // Ajuster la taille du lot en fonction du nombre de lignes traitées
        if (linesProcessed < 10) {
            batchSize = Math.min(25, MAX_BATCH_SIZE); 
        } else if (linesProcessed < 50) {
            batchSize = Math.min(100, MAX_BATCH_SIZE); 
        } else if (linesProcessed < 1000 && batchSize < 500) {
            batchSize = Math.min(500, MAX_BATCH_SIZE);
        }

        if (lineBuffer.length > 0) {
            requestAnimationFrame(processNextLines); // Continuer à traiter les lignes
        } else {
            isProcessing = false;
        }
    }

    requestAnimationFrame(processNextLines);
}

// Réception des lignes depuis le serveur et ajout dans le buffer
socket.on('line', (data) => {
    lineBuffer.push(data)
    processLines() // Traiter immédiatement la nouvelle ligne
})

// Réception des lignes tamponnées
socket.on('lines', (lines) => {
    lineBuffer.push(...lines);
    processLines() // Traiter les lignes tamponnées
})

// Gestion de la déconnexion du serveur
socket.on('disconnect', () => {
    finishedProcessing = true
    processLines() // Traiter les dernières lignes après déconnexion
})

// Fermer la connexion proprement lorsque la page est fermée
window.addEventListener('beforeunload', () => {
    socket.close()
})

// Lorsque le processus est terminé, vérifier les lignes vides et les supprimer
socket.on('finished', () => {
    finishedProcessing = true
    batchSize = Math.min(lineBuffer.length, MAX_BATCH_SIZE); // Traiter tout le cache restant
    processLines() // Réexécuter le traitement pour enlever les lignes vides
})

// Fonction d'auto-scroll
document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("code")
    const autoScrollButton = document.getElementById("auto-scroll")
    const scrollToTopButton = document.getElementById("scroll-to-top")
    const scrollToBottomButton = document.getElementById("scroll-to-bottom")
    let autoScrollEnabled = true

    // Toggle de l'auto-scroll
    autoScrollButton.addEventListener("click", () => {
        autoScrollEnabled = !autoScrollEnabled
        autoScrollButton.classList.toggle("active", autoScrollEnabled)
    })

    // Fonction pour défiler vers le haut
    scrollToTopButton.addEventListener("click", () => {
        codeElement.scrollTo({ top: 0, behavior: "smooth" })
    })

    // Fonction pour défiler vers le bas
    scrollToBottomButton.addEventListener("click", () => {
        codeElement.scrollTop = codeElement.scrollHeight
    })

    // Observer les mutations de DOM pour effectuer un auto-scroll
    const observer = new MutationObserver(() => {
        if (autoScrollEnabled) {
            codeElement.scrollTop = codeElement.scrollHeight
        }
    })

    observer.observe(codeElement, { childList: true, subtree: true })
})

// Gestion du focus et blur pour savoir quand l'utilisateur revient ou quitte la fenêtre
let isFocused = true

// Focus sur le client : demander les lignes tamponnées
window.addEventListener('focus', () => {
    if (!isFocused) {
        isFocused = true
        socket.emit('focus') // Envoie l'événement de focus au serveur
    }
})

// Perte de focus sur le client
window.addEventListener('blur', () => {
    if (isFocused) {
        isFocused = false
        socket.emit('blur') // Envoie l'événement de blur au serveur
    }
})
