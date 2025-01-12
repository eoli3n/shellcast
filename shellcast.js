const express = require('express'),
      http = require('http'),
      app = express(),
      cons = require('consolidate'),
      fs = require('fs'),
      os = require('os'),
      util = require('util'),
      split = require('split'),
      spawn = require('child_process').spawn,
      server = http.createServer(app),
      subdir = "/" + process.env.SUBDIR,
      { Server } = require('socket.io'),
      io = new Server(server, { path: subdir + '/socket.io' }),
      yaml = require('js-yaml'),
      morgan = require('morgan'),
      path = require('path'),
      favicon = require('serve-favicon'),
      validator = require('validator');

// Set trust proxy before adding any middleware or routes
app.set('trust proxy', true);

// Set up view engine and static resources
app.engine('html', cons.handlebars);
app.set('view engine', 'html');
app.set('views', __dirname + '/views/');
app.use(subdir, express.static(path.join(__dirname, '/public')));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(morgan('combined'));

// Load YAML config
let config;
try {
    config = yaml.safeLoad(fs.readFileSync(process.argv[2], 'utf8'));
} catch (error) {
    console.error('Error loading YAML config:', error);
    process.exit(1);
}

const forbiddenChars = ['>', '<', '|', '&', ';', '(', ')', '\\', '!', '*', '$', '=', '+', '~', '"', ' '];

// Fonction pour ajuster les caractères interdits selon la whitelist du service
const adjustForbiddenChars = (serviceConfig) => {
    // Si la whitelist est définie dans le service, on enlève ces caractères de la forbiddenChars
    if (serviceConfig.whitelist && Array.isArray(serviceConfig.whitelist)) {
        serviceConfig.whitelist.forEach(char => {
            const index = forbiddenChars.indexOf(char);
            if (index !== -1) {
                forbiddenChars.splice(index, 1); // Retirer le caractère de la forbiddenChars
            }
        });
    }
};

// Fonction pour trouver un caractère interdit dans un argument
const findForbiddenChar = (arg, serviceConfig) => {
    // On ajuste d'abord les forbiddenChars selon la whitelist du service
    adjustForbiddenChars(serviceConfig);

    // Cherche le premier caractère interdit dans l'argument et le retourne
    for (let char of forbiddenChars) {
        if (arg.includes(char)) {
            return char; // Retourne le premier caractère interdit trouvé
        }
    }
    return null; // Aucun caractère interdit trouvé
};

const validateParams = (params, req, res, serviceConfig) => {
    const errors = [];

    params.forEach(param => {
        const value = req.query[param];

        if (typeof value === 'undefined') {
            errors.push(`Missing "${param}" parameter`);
        } else {
            const forbiddenChar = findForbiddenChar(value, serviceConfig);
            if (forbiddenChar) {
                errors.push(`"${param}" contains forbidden character: "${forbiddenChar}"`);
            }
        }
    });

    return errors;
};

// Buffer for storing lines per client
const clientBuffers = new Map();

// Socket.io handling
io.sockets.on('connection', (socket) => {
    const clientId = socket.id;
    clientBuffers.set(clientId, []); // Initialize buffer for this client
    
    //console.log(`Client ${clientId} connected.`);

    socket.on('init', (url) => {
        let castArgs = [];
        let cmd = '';
        let castHighlightJson = [];
        
        // Find the cast corresponding to the URL
        const cast = config.find(c => c.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
        
        if (cast) {
            cmd = cast.cmd;
            // Prepare arguments for the command
            if (cast.args) {
                castArgs = cast.args.map(arg => socket.handshake.query[arg]);
            }
            // Load highlights
            castHighlightJson = cast.highlight || [];
            // Send highlights to client
            socket.emit('highlight', castHighlightJson);

            if (cast.args && cast.args.length > 0) {
                castArgs.forEach((arg, index) => {
                    const placeholder = `{${cast.args[index]}}`;
                    cmd = cmd.split(placeholder).join(arg);
                });
            }

            // Add magic clientIP var
            if (cmd.includes("{clientIp}")) {
                let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
                cmd = cmd.split("{clientIp}").join(clientIp);
                castArgs.push(clientIp);
            }

            const startTime = Date.now();

            const run = spawn('bash', ['-c', cmd]);

            run.stdout.pipe(split()).on('data', (data) => {
                const line = data.toString();
                //console.log('Line from stdout:', line);

                if (!socket.focus) {
                    //console.log(`Buffering line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
            });

            run.stderr.pipe(split()).on('data', (data) => {
                const line = data.toString();
                //console.log('Line from stderr:', line);

                if (!socket.focus) {
                    //console.log(`Buffering stderr line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending stderr line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
            });

            run.on('close', (code) => {

                const endTime = Date.now();
                const executionTimeInSeconds = (endTime - startTime) / 1000;
                const hours = Math.floor(executionTimeInSeconds / 3600);
                const minutes = Math.floor((executionTimeInSeconds % 3600) / 60);
                const seconds = Math.floor(executionTimeInSeconds % 60);
                const milliseconds = Math.round((executionTimeInSeconds % 1) * 1000);

                let executionTime = '';

                if (hours > 0) {
                    executionTime += `${hours}h `;
                }
                if (minutes > 0) {
                    executionTime += `${minutes}m `;
                }

                if (executionTimeInSeconds < 1) {
                    executionTime += `${milliseconds}ms`;
                } else {
                    executionTime += `${seconds}s`;
                }

                let ANSI_COLOR_RED = '\x1b[38;5;9m';  // Rouge
                let ANSI_COLOR_GREEN = '\x1b[38;5;10m'; // Vert
                let ANSI_RESET = '\x1b[0m';
                let ANSI_GRAY_ITALIC = '\x1b[38;5;8m\x1b[3m'; // Gris italique
                let ANSI_WHITE_ITALIC = '\x1b[97m\x1b[3m'; // Blanc italique
                let icon = (code !== 0) ? `${ANSI_COLOR_RED}✘${ANSI_RESET}` : `${ANSI_COLOR_GREEN}✔${ANSI_RESET}`;
                let line = `${icon} ${ANSI_WHITE_ITALIC}Command exited with code ${code} in ${executionTime}.${ANSI_RESET}`;
                if (!socket.focus) {
                    //console.log(`Buffering stderr line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending stderr line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
                console.log(`Command ${cmd} exited with code ${code}`);
            });

            socket.on('disconnect', () => {
                //console.log(`Client ${clientId} disconnected.`);
                if (run) run.kill('SIGTERM');
                clientBuffers.delete(clientId);
            });
        } else {
            socket.emit('line', 'Error: Cast not found for URL');
        }
    });

    socket.on('focus', () => {
        //console.log(`Client ${clientId} is now focused.`);
        const buffer = clientBuffers.get(clientId) || [];
        if (buffer.length > 0) {
            //console.log(`Sending buffered lines to ${clientId}:`, buffer);
            socket.emit('lines', buffer); // Send buffered lines to the client
            clientBuffers.set(clientId, []); // Clear buffer after sending
        }
        socket.focus = true;
    });

    socket.on('blur', () => {
        //console.log(`Client ${clientId} is now blurred.`);
        socket.focus = false;
    });
});

// Handle HTTP requests
config.forEach((cast) => {
    cast.url = subdir + cast.url.replace(/\/$/, '');
    
    app.get(cast.url, (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        if (cast.password && cast.password !== req.query.password) {
            return res.status(403).send('Missing or wrong password...');
        }
        const errors = validateParams(cast.args || [], req, res, cast);
        if (errors.length > 0) {
            return res.status(400).send(errors.join('<br>'));
        }
        res.setHeader('Content-Type', 'text/html');
        res.render('index', { title: cast.name, subdir: subdir });
    });

    app.get(cast.url + '/plain', (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        if (cast.password && cast.password !== req.query.password) {
            return res.status(403).send('Incorrect or missing password...');
        }
        const errors = validateParams(cast.args || [], req, res, cast);
        if (errors.length > 0) {
            return res.status(400).send(errors.join('<br>'));
        }

        let cmd = cast.cmd;
        const castArgs = cast.args ? cast.args.map(arg => req.query[arg]) : [];

        //console.log("castArgs : " + castArgs)
        
        if (cast.args && cast.args.length > 0) {
            castArgs.forEach((arg, index) => {
                const placeholder = `{${cast.args[index]}}`;
                cmd = cmd.split(placeholder).join(arg);
            });
        }

        // Add magic clientIP var
        if (cmd.includes("{clientIp}")) {
            let clientIp = req.ip;
            cmd = cmd.split("{clientIp}").join(clientIp);
            castArgs.push(clientIp);
        }

        const run = spawn('bash', ['-c', cmd]);

        run.stdout.pipe(res);
        run.stderr.pipe(res);
        
        run.on('error', (error) => {
            console.error('Error spawning process:', error);
            res.status(500).send(`Error spawning process: ${error.message}`);
        });
        
        run.on('close', (code) => {
            console.log(`Command ${cmd} exited with code ${code}`);
        });
    });
});

// Handle 404 errors
app.use((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.status(404).send('Page Not Found...');
});

// Start the server and listen only ipv4
server.listen(process.env.NODE_PORT, '0.0.0.0', () => {
    console.log('Server listening on *:' + process.env.NODE_PORT);
});
