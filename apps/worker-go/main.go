package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type WeatherPayload struct {
	City      string            `json:"city"`
	Timestamp time.Time         `json:"timestamp"`
	Source    string            `json:"source"`
	Metrics   map[string]any    `json:"metrics"`
	Meta      map[string]string `json:"meta,omitempty"`
}

func main() {
	log.Println("Worker Go iniciando pipeline (RabbitMQ → API NestJS).")

	rabbitURL := getEnv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
	apiURL := fixInternalHost(getEnv("API_URL", "http://api:3000/api/weather/logs"))
	queueName := getEnv("WEATHER_QUEUE", "weather-logs")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := amqp.Dial(rabbitURL)
	if err != nil {
		log.Fatalf("conexão com RabbitMQ falhou: %v", err)
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("não foi possível abrir canal: %v", err)
	}
	defer ch.Close()

	if _, err := ch.QueueDeclare(
		queueName,
		true,  // durable
		false, // auto delete
		false, // exclusive
		false, // no wait
		nil,
	); err != nil {
		log.Fatalf("falha ao declarar fila: %v", err)
	}

	if err := ch.Qos(1, 0, false); err != nil {
		log.Fatalf("falha ao configurar QoS: %v", err)
	}

	msgs, err := ch.Consume(
		queueName,
		"gdash-worker",
		false,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatalf("erro ao consumir fila: %v", err)
	}

	log.Printf("consumindo mensagens da fila %s (API: %s)", queueName, apiURL)

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	currentToken, err := obtainAuthToken(client, apiURL)
	if err != nil {
		log.Fatalf("falha ao obter token JWT: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("sinal recebido, encerrando worker")
			return
		case msg, ok := <-msgs:
			if !ok {
				log.Println("fila fechada pelo RabbitMQ")
				return
			}
			token, err := handleMessage(ctx, client, apiURL, msg, currentToken)
			if err != nil {
				log.Printf("falha no manuseio da mensagem: %v", err)
			}
			if token != "" {
				currentToken = token
			}
		}
	}
}

func handleMessage(ctx context.Context, client *http.Client, apiURL string, msg amqp.Delivery, token string) (string, error) {
	var payload WeatherPayload
	if err := json.Unmarshal(msg.Body, &payload); err != nil {
		log.Printf("payload inv?lido recebido: %v", err)
		msg.Nack(false, false)
		return token, fmt.Errorf("payload inv?lido: %w", err)
	}

	if err := sendToAPI(ctx, client, apiURL, payload, token); err != nil {
		if strings.Contains(err.Error(), "401") {
			log.Println("token inválido, renovando")
			newToken, authErr := obtainAuthToken(client, apiURL)
			if authErr != nil {
				msg.Nack(false, true)
				return token, fmt.Errorf("erro ao renovar token: %w", authErr)
			}
			if err2 := sendToAPI(ctx, client, apiURL, payload, newToken); err2 != nil {
				msg.Nack(false, true)
				return newToken, fmt.Errorf("erro após renovar token: %w", err2)
			}
			msg.Ack(false)
			return newToken, nil
		}
		msg.Nack(false, true)
		return token, fmt.Errorf("erro ao enviar para API: %w", err)
	}

	msg.Ack(false)
	return token, nil
}

func sendToAPI(ctx context.Context, client *http.Client, apiURL string, payload WeatherPayload, token string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("erro ao serializar payload: %w", err)
	}

	timestamp := payload.Timestamp.Format(time.RFC3339)
	log.Printf("sending weather log to API city=%s timestamp=%s", payload.City, timestamp)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("cria??o da requisi??o falhou: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("erro HTTP ao enviar log city=%s timestamp=%s: %v", payload.City, timestamp, err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		log.Printf("weather log failed city=%s timestamp=%s status=%d", payload.City, timestamp, resp.StatusCode)
		if len(data) > 0 {
			return fmt.Errorf("status inesperado da API: %s (%s)", resp.Status, strings.TrimSpace(string(data)))
		}
		return fmt.Errorf("status inesperado da API: %s", resp.Status)
	}

	log.Printf("weather log sent city=%s timestamp=%s status=%d", payload.City, timestamp, resp.StatusCode)
	return nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func buildAuthURL(apiURL string) string {
	base := strings.TrimRight(apiURL, "/")
	if idx := strings.Index(base, "/api/"); idx != -1 {
		base = strings.TrimRight(base[:idx+4], "/")
	}
	return fmt.Sprintf("%s/auth/login", base)
}

func obtainAuthToken(client *http.Client, apiURL string) (string, error) {
	email := getEnv("API_AUTH_EMAIL", "admin@example.com")
	password := getEnv("API_AUTH_PASSWORD", "123456")
	authURL := buildAuthURL(apiURL)

	payload := map[string]string{
		"email":    email,
		"password": password,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("erro ao serializar credenciais: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, authURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("erro ao criar requisição de login: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("falha na requisição de login: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("login retornou status %s", resp.Status)
	}

	var authResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return "", fmt.Errorf("falha ao decodificar token: %w", err)
	}

	log.Printf("obteve token JWT via %s", email)

	if authResp.AccessToken == "" {
		return "", fmt.Errorf("token não retornado")
	}

	return authResp.AccessToken, nil
}

func fixInternalHost(value string) string {
	if strings.Contains(value, "://api:") {
		return strings.Replace(value, "://api:", "://localhost:", 1)
	}
	return value
}
