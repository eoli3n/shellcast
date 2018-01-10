## Installation
```
mkdir -p /srv/node
cd /srv/node
git clone ...
cd shellcast
npm install
```

## Configurer NGINX
```
cat << EOF > /etc/nginx/sites-available/shellcast
server {
    root /srv/node/ansiblecast;
    listen      8080 ssl;

    ssl_certificate      /etc/ssl/cert.crt
    ssl_certificate_key  /etc/ssl/cert.key;
    ssl_session_timeout 5m;
    ssl_protocols        TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers          HIGH:!ADH:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
ln -s /etc/nginx/sites-available/shellcast /etc/nginx/sites-enabled/shellcast
systemctl restart nginx
```

## Start NodeJS app with pm2

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
