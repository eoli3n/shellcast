const regexCache = new Map()

// Buffer pour l'affichage des lignes
const lineBuffer = []
let isProcessing = false
let finishedProcessing = false  // Indicateur pour la fin du processus

// Fonction de mise en cache des regex
const getRegex = (pattern) => {
    if (!regexCache.has(pattern)) {
        regexCache.set(pattern, new RegExp(pattern))
    }
    return regexCache.get(pattern)
}

// Optimisation de l'autoscroll avec requestAnimationFrame
let scrollTimeout
const smartScroll = () => {
    if (scrollTimeout) return
    
    scrollTimeout = requestAnimationFrame(() => {
        const html = document.documentElement
        html.scrollTop = html.scrollHeight
        scrollTimeout = null
    })
}

// Connexion socket
const locationSub = window.location.origin + window.location.search
const socket = io.connect(locationSub, {
    path: '/' + window.location.pathname.split('/')[1] + '/socket.io',
    transports: ['websocket'],
    upgrade: false
})

let jsonHighlight = []

// Initialisation
socket.emit('init', window.location.pathname)

// Réception de la configuration highlight
socket.on('highlight', (data) => {
    jsonHighlight = data || []
    jsonHighlight.forEach(hl => {
        if (hl.word) getRegex(hl.word)
        if (hl.line) getRegex(hl.line)
    })
    
    socket.emit('run')
})

// Créer une ligne
const createSpan = (word) => {
    const span = document.createElement('span')
    span.textContent = word + ' '
    return span
}

// Application des highlights sur les mots ou les lignes
const applyHighlights = (element, text, isLine = false) => {
    for (const hl of jsonHighlight) {
        const pattern = hl[isLine ? 'line' : 'word']
        if (pattern && getRegex(pattern).test(text)) {
            element.classList.add(hl.class)
        }
    }
}

// Créer une ligne complète avec les éléments
const createLine = (data) => {
    const lineDiv = document.createElement('div')
    lineDiv.className = 'log-line'
    
    // Ajout du lien vide pour la numérotation CSS
    const link = document.createElement('a')
    lineDiv.appendChild(link)
    
    // Traitement des mots et highlights
    const words = data.split(' ')
    for (const word of words) {
        const span = createSpan(word)
        applyHighlights(span, word, false)
        lineDiv.appendChild(span)
    }
    
    // Application des highlights de ligne
    applyHighlights(lineDiv, data, true)
    
    return lineDiv
}

// Traitement des lignes optimisé
const processLines = () => {
    if (isProcessing) return
    isProcessing = true

    const processNextLine = () => {
        if (lineBuffer.length === 0) {
            if (finishedProcessing) {
                // Si nous avons fini et qu'il y a 2 lignes vides à la fin, on les retire
                if (lineBuffer[lineBuffer.length - 1]?.trim() === '' && lineBuffer[lineBuffer.length - 2]?.trim() === '') {
                    lineBuffer.pop(); // Supprimer la dernière ligne vide
                    lineBuffer.pop(); // Supprimer l'avant-dernière ligne vide
                }
            }
            isProcessing = false
            return
        }

        const line = lineBuffer.shift().trim();
        if (line.length === 0) {
            // Ignore empty lines except for the last two
            return processNextLine()
        }

        const fragment = document.createDocumentFragment()
        fragment.appendChild(createLine(line))

        document.getElementById('code').appendChild(fragment)
        smartScroll()

        requestAnimationFrame(processNextLine)
    }

    requestAnimationFrame(processNextLine)
}

// Réception des lignes
socket.on('line', (data) => {
    lineBuffer.push(data)
    processLines()
})

// Réception de la déconnexion
socket.on('disconnect', () => {
    finishedProcessing = true
    processLines() // Traiter les dernières lignes
})

// Déconnexion propre
window.addEventListener('beforeunload', () => {
    socket.close()
})

// Lorsque le processus est terminé, et si deux lignes vides sont présentes, les supprimer
socket.on('finished', () => {
    finishedProcessing = true;
    processLines();  // Réexécuter le traitement final pour enlever les lignes vides
})

// Fonction de mise à jour de l'auto-scroll
document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("code");
    const autoScrollButton = document.getElementById("auto-scroll");
    const scrollToTopButton = document.getElementById("scroll-to-top");
    const scrollToBottomButton = document.getElementById("scroll-to-bottom");
    let autoScrollEnabled = true;

    // Toggle auto-scroll
    autoScrollButton.addEventListener("click", () => {
        autoScrollEnabled = !autoScrollEnabled;
        autoScrollButton.classList.toggle("active", autoScrollEnabled);
    });

    // Scroll to top
    scrollToTopButton.addEventListener("click", () => {
        codeElement.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Scroll to bottom
    scrollToBottomButton.addEventListener("click", () => {
        codeElement.scrollTo({ top: codeElement.scrollHeight, behavior: "smooth" });
    });

    // Auto-scroll functionality
    const observer = new MutationObserver(() => {
        if (autoScrollEnabled) {
            codeElement.scrollTop = codeElement.scrollHeight;
        }
    });

    observer.observe(codeElement, { childList: true, subtree: true });
});
