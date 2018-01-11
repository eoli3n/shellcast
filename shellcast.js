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
    //remove last '/' fix
    app.get( cast.url.replace(/\/$/, '') , function(req, res) {
    
        // if secure=yes test password param
        if (config.default.secure === "yes") {
            if (config.default.password != req.query.password) {
                res.status(404).send('<span>Missing or wrong password...</span>')
            }
        }
    
        //init render args
        var values = { 
            title: cast.name
        }

        //template dynamic highlight
        //if (cast.highlight) {
        //    values['highlight-line'] = {}
        //    values['highlight-word'] = {}
        //    cast.highlight.forEach(function (hl){
        //        if (hl.line) {
        //            values['highlight-line'][hl.line] = hl.color
        //        } else if (hl.word){
        //            values['highlight-word'][hl.word] = hl.color
        //        }
        //    })
        //}

        // render html
        res.render('index', values)
    })
})

io.sockets.on('connection', function (socket) {
    console.log('Socket connected.')
    console.log(socket.handshake.query)

    //debug
    socket.on('log', function(data){
        console.log(data)
    })

    socket.on('init', function (url) {
        console.log('url: ' + url)

        //match yml and client url
        casts.forEach(function (cast){
            //remove last '/' fix
            if (cast.url.replace(/\/$/, '') == url.replace(/\/$/, '')){
                // get string cmd
                cmd_string = cast.cmd
                // get args
                cast_args = []
                cast.args.forEach(function (arg){
                    cast_args.push(socket.handshake.query[arg])
                })
                // get highlight to json
                cast_highlight_json = cast.highlight
            }
        })
    
        //send json highlight -> client
        socket.emit('highlight', cast_highlight_json)

        //replace args
        cast_args.forEach( function (arg){
            cmd_string = cmd_string.replace('{}', arg)
        })
    
        //format to spawn dict
        var cmd = cmd_string.split(' ')
        var cmd_first = cmd[0]
        cmd.shift()
    
        //run
        socket.on('run', function () {
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
                console.log( 'Cast ' + url + ' exited with code ' + code)
            })
        })
    
        //on disconnect
        socket.on('disconnect', function() {
            //console.log( socket.handshake.query['target'] + ' : socket disconnected.')
            run.kill('SIGHUP')
        })
    })
})

app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html')
    res.status(404).send('<span>Page Introuvable...</span>')
})

server.listen(8000)