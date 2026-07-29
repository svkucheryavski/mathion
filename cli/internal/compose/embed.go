package compose

import _ "embed"

//go:embed docker-compose.yml
var ComposeYAML []byte
