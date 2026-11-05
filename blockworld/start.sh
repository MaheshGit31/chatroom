#!/bin/sh
cd /app
mkdir -p /data
for d in levels players blockdb extra ranks text properties plugins blockdefs bots logs; do
  mkdir -p /data/$d
  rm -rf /app/$d
  ln -s /data/$d /app/$d
done
[ -f /data/MCGalaxy.db ] || touch /data/MCGalaxy.db
ln -sf /data/MCGalaxy.db /app/MCGalaxy.db
[ -f /data/properties/server.properties ] || cp /defaults/server.properties /data/properties/server.properties
FIRST=0
[ -f /data/levels/world.lvl ] || FIRST=1
{
  if [ "$FIRST" = 1 ]; then
    sleep 20
    printf '/newlvl world 256 96 256 forest\n'
    sleep 40
    printf '/main world\n'
    sleep 5
    printf '/rank bart owner confirm\n'
    sleep 3
  fi
  tail -f /dev/null
} | dotnet /app/MCGalaxyCLI.dll
