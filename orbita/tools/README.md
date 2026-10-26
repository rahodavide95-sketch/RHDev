# Strumenti

## build-data.cjs: rigenerare i dataset in `data/`

Serve solo per aggiornare paesi, confini, città o aeroporti. L'app usa i file già pronti.

```bash
mkdir -p /tmp/orbita-build/raw && cd /tmp/orbita-build
npm init -y && npm install world-countries@5.1.0 all-the-cities@3.1.0 mapshaper@0.7.98
B=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_50m_admin_0_countries ne_10m_admin_1_states_provinces ne_10m_populated_places; do
  curl -sSL -o raw/$f.geojson $B/$f.geojson
done
curl -sSL -o raw/airports.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
cd /percorso/del/repo/orbita
NODE_PATH=/tmp/orbita-build/node_modules node tools/build-data.cjs /tmp/orbita-build/raw
npm test
```
