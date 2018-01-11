var socket = io.connect(window.location.origin + window.location.search, { reconnection: false })

socket.emit('run', window.location.pathname );

socket.on('highlight', (data) => {
    json_highlight = data
});

socket.on('line', (data) => {
    //debug
    socket.emit('log', json_highlight)
    var preline = $.map(data.split(' '), function(word) {
        var a = $('<span>', { text: word + ' ' })
        json_highlight.forEach(function (hl){
            if (hl['word']){
               a.toggleClass(hl['color'], word.match('/' + hl['word'] + '/') != null )
            }
        })
        return a;
    });

    var line = $('<div>', { class: 'log-line' }).append('<a>').append(preline);

    //line hilight
    json_highlight.forEach(function (hl){
        if (hl['line']){
            line.toggleClass(hl['color'], data.match('/' + hl['word'] + '/') != null);
        }

    $('#code').append(line);

    //Then scroll to that line
    // see http://jsfiddle.net/7Lquu899/4/ for complete page scroll
    $('#code').animate({scrollTop: $('#code').prop("scrollHeight")}, 10);
    })
});