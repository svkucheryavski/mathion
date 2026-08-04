package dockerx

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func HealthProbe(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/health returned %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if !strings.Contains(string(b), `"status":"ok"`) {
		return fmt.Errorf("/health body not ok: %q", string(b))
	}
	return nil
}
