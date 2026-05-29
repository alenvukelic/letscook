# Server Scripts

Reusable Ubuntu server setup scripts for Letscook and future projects.

## Current Scripts

- `python-1-install.sh`: installs Python tooling for backend work.
- `nodejs-1-install.sh`: installs Node.js and npm.
- `postgresql-1-install.sh`: installs PostgreSQL.
- `ssl-1-letsencrypt-nginx.sh`: configures Let's Encrypt SSL for one nginx site.

## Letscook SSL Setup

Default domain:

```bash
kuharica.freeddns.org
```

Default nginx site:

```bash
/etc/nginx/sites-available/letscook
```

Run on the server:

```bash
sudo bash ssl-1-letsencrypt-nginx.sh
```

The script will:

1. verify Ubuntu, nginx, Certbot, DNS, webroot, and backend assumptions
2. create a timestamped backup of the selected nginx site file
3. issue or reuse a Let's Encrypt certificate with `certbot certonly --webroot`
4. write HTTPS nginx configuration for only the selected site
5. keep HTTP serving the app while HTTPS is added, so the site does not break if port 443 still needs router or firewall work
6. enable the selected nginx site symlink without touching other sites
7. install a safe Certbot deploy hook that reloads nginx after renewals
8. run `nginx -t`, reload nginx, and verify the HTTPS response

## Safety Notes

- The script does not delete unrelated nginx configs.
- The script does not modify unrelated certificates.
- Existing certificates are reused when Certbot reports they are still valid.
- Existing nginx site files are backed up before replacement.
- If rollback is needed, restore the generated backup and reload nginx:

```bash
sudo cp /etc/nginx/sites-available/letscook.backup-YYYYMMDD-HHMMSS /etc/nginx/sites-available/letscook
sudo nginx -t
sudo systemctl reload nginx
```

## Manual Equivalent

If you do not want to use the script, follow the same steps manually:

1. confirm DNS points to this server with `getent ahosts kuharica.freeddns.org`
2. confirm nginx serves the app over HTTP
3. run Certbot with webroot validation
4. add the certificate paths to the Letscook nginx site while preserving the HTTP app server block
5. test nginx with `sudo nginx -t`
6. reload nginx with `sudo systemctl reload nginx`
7. verify `https://kuharica.freeddns.org`
