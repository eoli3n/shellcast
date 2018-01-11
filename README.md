# ShellCast

## Examples

### Rainbow
A node app to stream multiple shell output realtime with args and highlighting.

``casts.yml``
```
- name: Rainbow
  description: "Test word highlights and stream"
  url: /rainbow
  cmd: ./tests/rainbow.sh
  # 'word' and 'line' support RegExp
  # 'class' could be any class define in public/css/custom.css
  highlight:
    # 'word' highlight only matching word
    - word: 'white'
      class: white
    - word: 'hide'
      class: hide
    - word: 'gray'
      class: gray
    - word: 'red'
      class: red
    - word: 'orange'
      class: orange
    - word: 'yellow'
      class: yellow
    - word: 'purple'
      class: purple
    - word: 'blue'
      class: blue
    - word: 'green'
      class: green
    # 'line' highlight only matching line
    - line: '0.1'
      class: yellow
```
``tests/rainbow.sh``
```
 #!/bin/bash
for i in {0..20..1}
do
    echo "white hide gray hide red hide orange hide yellow hide purple hide blue hide green" 
    echo "...lets sleep 0.$i s"
    sleep 0.$i
done   
```
![Alt Text](tests/rainbow.gif)

### Args

``casts.yml``
```
- name: Args
  description: "Test args and suburls"
  url: /args/test
  # Get /args/test?hostname=foo&ip=192.168.0.1&mac=00:11:22:33:44:55
  # will be run as "./tests/args.sh foo 192.168.0.1 00:11:22:33:44:55"
  cmd: ./tests/args.sh {} {} {}
  args:
    - hostname
    - ip
    - mac
```
``tests/args.sh``
```
#!/bin/bash

printf "%-20s" "Hostname:"
printf "$1\n"
printf "%-20s" "IP:"
printf "$2\n"
printf "%-20s" "Mac:"
printf "$3\n"
```
![Alt Text](tests/args.png)

## Installation
```
git clone https://github.com/eoli3n/shellcast
cd shellcast
npm install
```
## Configuration
Please read [casts.yml](casts.yml) and [config.ini](config.ini)

### Configure with nginx
```
mkdir -p /srv/node
cd /srv/node
##install
```
```
cat << EOF > /etc/nginx/sites-available/shellcast
server {
    root /srv/node/shellcast;
    listen      443 ssl;

    ssl_certificate      /etc/ssl/cert.crt
    ssl_certificate_key  /etc/ssl/cert.key;
    ssl_session_timeout 5m;
    ssl_protocols        TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers          HIGH:!ADH:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
```

```
ln -s /etc/nginx/sites-available/shellcast /etc/nginx/sites-enabled/shellcast
systemctl restart nginx
```

### Start NodeJS app with pm2

```
# install pm2
npm install pm2 -g

# start
cd /srv/node/shellcast
pm2 start shellcast.js

# infos
pm2 show shellcast

# logs
pm2 logs shellcast --lines 100

# restart
pm2 restart shellcast
```
