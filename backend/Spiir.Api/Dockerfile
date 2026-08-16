FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 8080
# Microsoft.Data.SqlClient's Entra ID (Active Directory Managed Identity) auth path needs
# native Kerberos libraries not present in the minimal aspnet runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends libkrb5-3 && rm -rf /var/lib/apt/lists/*
# .NET's JIT write-xor-execute memory protection segfaults (exit 139) in some sandboxed
# container environments, including Azure Container Apps Consumption plan. Documented .NET
# runtime workaround: https://github.com/dotnet/runtime/issues/71786
ENV DOTNET_EnableWriteXorExecute=0
# Server GC sizes itself off the perceived core count, which can misbehave under fractional
# CPU allocations (this app runs at 0.5 vCPU) in sandboxed container environments — a known
# cause of startup crashes on Azure Container Apps Consumption plan.
ENV DOTNET_gcServer=0

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["Spiir.Api.csproj", "./"]
RUN dotnet restore "Spiir.Api.csproj"
COPY . .
RUN dotnet publish "Spiir.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Spiir.Api.dll"]
