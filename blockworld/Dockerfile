FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 1.9.5.3 https://github.com/ClassiCube/MCGalaxy.git /src
RUN sed -i 's/service.Salt = Server.GenerateSalt();/service.Salt = System.Environment.GetEnvironmentVariable("BW_SALT") ?? Server.GenerateSalt();/' /src/MCGalaxy/Server/Authentication/AuthService.cs && grep -q BW_SALT /src/MCGalaxy/Server/Authentication/AuthService.cs
WORKDIR /src/CLI
RUN dotnet build MCGalaxyCLI_dotnet8.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:8.0
RUN apt-get update && apt-get install -y --no-install-recommends libgdiplus libsqlite3-0 && ln -s $(ls /usr/lib/*/libsqlite3.so.0 | head -1) /usr/lib/libsqlite3.so && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY server.properties /defaults/server.properties
COPY start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
EXPOSE 25565
CMD ["/start.sh"]
