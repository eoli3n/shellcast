var express = require('express')
  , app = express()
  , cons = require('consolidate')
  , fs = require('fs')
  , os = require('os')
  , util = require('util')
  , split = require('split')
  , spawn = require('child_process').spawn
  , server = require('http').Server(app)
  , io = require('socket.io')(server, {
    cookie: false
  })
  , yaml = require('js-yaml')
  , ini = require('ini')
  , morgan = require('morgan')
  , path= require('path')
  , favicon = require('serve-favicon')
  , sass = require('node-sass')

// assign the handlebars engine to .html files
app.engine('html', cons.handlebars)

// set .html as the default extension
app.set('view engine', 'html')
app.set('views', __dirname + '/views')

// declare static ressources
app.use(express.static(__dirname + '/public'))

// serve favicon
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')))

// morgan logs
app.use(morgan('combined'))

// read config file
var config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'))

// read yaml file
var casts = yaml.safeLoad(fs.readFileSync('casts.yml', 'utf8'));

// when query /host
casts.forEach(function (cast){
    app.get('/' + cast.name + '/', function(req, res) {
    
        // if secure=yes test password param
        if (config.default.secure === "yes") {
            if (config.default.password != req.query.password) {
                res.status(404).send('<span>Missing or wrong password...</span>')
            }
        }
    
        //init render args
        var values = { 
            title: 'Cast ' + cast.name,
            server: config.default.server,
            cmd: cast.name
        }

        //template dynamic args
        if (cast.args) {
            values['args'] = {}
            cast.args.forEach(function (arg){
                //test missing args
                if (req.query[arg]){
                    values['args'][arg] = req.query[arg]
                }else{
                    res.status(404).send('<span>Missing argument ' + arg + '</span>')
                }
            })
        }

        //template dynamic hilight
        if (cast.hilight) {
            values['hilight-line'] = {}
            values['hilight-word'] = {}
            cast.hilight.forEach(function (hl){
                if (hl.line) {
                    values['hilight-line'][hl.line] = hl.color
                } else if (hl.word){
                    values['hilight-word'][hl.word] = hl.color
                }
            })
        }

        //debug
        console.log(values)

        // render html
        res.render('index', values)
    })
})

io.sockets.on('connection', function (socket) {
    console.log('Socket connected.')
    console.log( 'Cast : ' + socket.handshake.query['cmd'] )

    //search cmd in yml
    cmd_args = ""
    casts.forEach(function (cast){
        if (cast.name == socket.handshake.query['cmd']){
            // get string cmd
            cmd_string = cast.cmd
            // get dynamic args
            cast.args.forEach(function (arg){
                cmd_args = cmd_args.concat(socket.handshake.query[arg] + ' ')
            })
        }
    })

    //replace args
    cmd_args.split(' ').forEach( function (arg){
        cmd_string = cmd_string.replace('{}', arg)
    })

    //format to spawn dict
    var cmd = cmd_string.split(' ')
    var cmd_first = cmd[0]
    cmd.shift()

    //run
    run = spawn(cmd_first, cmd)

    //on new data
    //stdout
    run.stdout.pipe(split()).on('data', (data) => {
        line = `${data}`
        //console.log(line)
        socket.emit('line', line)
    })

    //stderr
    run.stderr.pipe(split()).on('data', (data) => {
        line = `${data}`
        //console.log(line)
        socket.emit('line', line)
    })

    //on close
    run.on('close', function (code) {
        console.log( 'Cast ' + socket.handshake.query['cmd'] + ' exited with code ' + code)
    })

    //on disconnect
    socket.on('disconnect', function() {
        //console.log( socket.handshake.query['target'] + ' : socket disconnected.')
        run.kill('SIGHUP')
    })
})

app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html')
    res.status(404).send('<span>Page Introuvable...</span>')
})

server.listen(8000)