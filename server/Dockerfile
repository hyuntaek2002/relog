# relog 서버 이미지. 저장소 루트를 빌드 컨텍스트로 쓴다(카탈로그 단일 원본 catalog/catalog.json을 함께 넣기 위해).
#   docker build -f server/Dockerfile -t relog-server .
# 이미지에는 서버 jar와 카탈로그만 들어간다. 대화 파일·웹 소스는 .dockerignore로 제외.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY catalog/catalog.json catalog/catalog.json
COPY server/pom.xml server/pom.xml
WORKDIR /src/server
# 의존성만 먼저 받아 캐시한다
RUN mvn -q -B dependency:go-offline
COPY server/src src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 1001 relog
COPY --from=build /src/server/target/server-0.0.1-SNAPSHOT.jar app.jar
USER relog
EXPOSE 8080
# 설정은 환경 변수로: SPRING_DATASOURCE_URL / _USERNAME / _PASSWORD, RELOG_CORS_ORIGINS, SERVER_PORT
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
