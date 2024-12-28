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
      shellEscape = require('shell-escape'),
      validator = require('validator');

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

// Validate parameters
const validateParams = (params, req, res) => {
    const errors = [];
    params.forEach(param => {
        if (typeof req.query[param] === 'undefined') {
            errors.push(`Missing "${param}" parameter`);
        } else if (/[\;&<>|()/\\!*\$=+~]/.test(req.query[param])) {
            errors.push(`"${param}" cannot contain special characters`);
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
        let cmdString = '';
        let castHighlightJson = [];
        
        // Find the cast corresponding to the URL
        const cast = config.find(c => c.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
        
        if (cast) {
            cmdString = cast.cmd;
            // Prepare arguments for the command
            if (cast.args) {
                castArgs = cast.args.map(arg => socket.handshake.query[arg]);
            }
            // Load highlights
            castHighlightJson = cast.highlight || [];
            // Send highlights to client
            socket.emit('highlight', castHighlightJson);

            const escapedArgs = castArgs.map(arg => shellEscape([arg]).replace(/^'(.*)'$/, '$1'));
            escapedArgs.forEach((escapedArg, index) => {
                const placeholder = `{${cast.args[index]}}`;
                cmdString = cmdString.split(placeholder).join(escapedArg);
            });

            const cmdList = cmdString.split(' ');
            const cmdFirst = cmdList.shift();

            console.log('Final command:', cmdString);
            //console.log('Sending highlight config:', castHighlightJson);

            const run = spawn(cmdFirst, cmdList);

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
                console.log(`Command ${cmdString} exited with code ${code}`);
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
        const errors = validateParams(cast.args || [], req, res);
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
        const errors = validateParams(cast.args || [], req, res);
        if (errors.length > 0) {
            return res.status(400).send(errors.join('<br>'));
        }

        let cmd = cast.cmd;
        const castArgs = cast.args ? cast.args.map(arg => req.query[arg]) : [];
        
        // Escaper chaque argument individuellement
        const escapedArgs = castArgs.map(arg => 
          shellEscape([arg]).replace(/^'(.*)'$/, '$1')
        );
        
        if (cast.args && cast.args.length > 0) {
            escapedArgs.forEach((escapedArg, index) => {
                const placeholder = `{${cast.args[index]}}`;
                cmd = cmd.split(placeholder).join(escapedArg);
            });
        }

        const cmdList = cmd.split(' ');
        const cmdFirst = cmdList.shift();
        const run = spawn(cmdFirst, cmdList);
        
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

// Start the server
server.listen(process.env.NODE_PORT, () => {
    console.log('Server listening on *:' + process.env.NODE_PORT);
});
