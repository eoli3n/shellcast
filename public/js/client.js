// Cache des expressions régulières
const regexCache = new Map()

// Buffer pour l'affichage des lignes
const lineBuffer = []
let isProcessing = false

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

// Connection socket avec configuration optimisée
const locationSub = window.location.origin + window.location.search
const socket = io.connect(locationSub, {
    path: '/' + window.location.pathname.split('/')[1] + '/socket.io',
    transports: ['websocket'],
    upgrade: false
})

// Variables pour le highlight
let jsonHighlight = []

// Initialisation
socket.emit('init', window.location.pathname)

// Réception de la configuration highlight
socket.on('highlight', (data) => {
    jsonHighlight = data || []
    
    // Pré-compilation des expressions régulières
    jsonHighlight.forEach(hl => {
        if (hl.word) getRegex(hl.word)
        if (hl.line) getRegex(hl.line)
    })
    
    socket.emit('run')
})

// Création optimisée des éléments span
const createSpan = (word) => {
    const span = document.createElement('span')
    span.textContent = word + ' '
    return span
}

// Application optimisée des highlights
const applyHighlights = (element, text, isLine = false) => {
    for (const hl of jsonHighlight) {
        const pattern = hl[isLine ? 'line' : 'word']
        if (pattern && getRegex(pattern).test(text)) {
            element.classList.add(hl.class)
        }
    }
}

// Création d'une ligne
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

// Traitement optimisé des lignes avec requestAnimationFrame
const processLines = () => {
    if (isProcessing) return
    isProcessing = true

    const processNextLine = () => {
        if (lineBuffer.length === 0) {
            isProcessing = false
            return
        }

        const line = lineBuffer.shift()
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

// Nettoyage à la déconnexion
socket.on('disconnect', () => {
    processLines() // Traiter les dernières lignes
})

// Déconnexion propre
window.addEventListener('beforeunload', () => {
    socket.close()
})
