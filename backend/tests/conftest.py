import pytest
from fastapi.testclient import TestClient

from mathion.main import app


@pytest.fixture
def client():
    return TestClient(app)
