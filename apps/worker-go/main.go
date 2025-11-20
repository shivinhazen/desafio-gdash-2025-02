package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
	Metrics   map[string]any    `json:"metrics"`
	Source    string            `json:"source"`
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
			if err := handleMessage(ctx, client, apiURL, msg); err != nil {
				log.Printf("falha no manuseio da mensagem: %v", err)
			}
		}
	}
}

func handleMessage(ctx context.Context, client *http.Client, apiURL string, msg amqp.Delivery) error {
	var payload WeatherPayload
	if err := json.Unmarshal(msg.Body, &payload); err != nil {
		msg.Nack(false, false)
		return fmt.Errorf("payload inválido: %w", err)
	}

	if err := sendToAPI(ctx, client, apiURL, payload); err != nil {
		msg.Nack(false, true)
		return fmt.Errorf("erro ao enviar para API: %w", err)
	}

	msg.Ack(false)
	return nil
}

func sendToAPI(ctx context.Context, client *http.Client, apiURL string, payload WeatherPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("erro ao serializar payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("criação da requisição falhou: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("status inesperado da API: %s", resp.Status)
	}

	return nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func fixInternalHost(value string) string {
	if strings.Contains(value, "://api:") {
		return strings.Replace(value, "://api:", "://localhost:", 1)
	}
	return value
}
