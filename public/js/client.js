//connect socket
var socket = io.connect(window.location.origin + window.location.search, { reconnection: false })

//trigger run with cast url
socket.emit('run', window.location.pathname );

//get cast highlight
socket.on('highlight', (data) => {
    json_highlight = data
});

//stream lines
socket.on('line', (data) => {
    //debug
    socket.emit('log', json_highlight)

    //word highlight
    var preline = $.map(data.split(' '), function(word) {
        var a = $('<span>', { text: word + ' ' })
        json_highlight.forEach(function (hl){
            if (hl['word']){
               a.toggleClass(hl['color'], word.match('/' + hl['word'] + '/') != null )
            }
        })
        return a;
    });
 
    //add word highlited preline to line var
    var line = $('<div>', { class: 'log-line' }).append('<a>').append(preline);

    //line highlight
    json_highlight.forEach(function (hl){
        if (hl['line']){
            line.toggleClass(hl['color'], data.match('/' + hl['word'] + '/') != null);
        }
    
    //add line to console
    $('#code').append(line);

    //Autoscroll
    // see http://jsfiddle.net/7Lquu899/4/ for complete page scroll
    $('#code').animate({scrollTop: $('#code').prop("scrollHeight")}, 10);

    })
});