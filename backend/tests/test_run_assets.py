import io


def test_upload_run_asset(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("dataset.csv", io.BytesIO(b"a,b,c\n1,2,3"), "text/csv")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "dataset.csv"
    assert body["file_size"] == len(b"a,b,c\n1,2,3")


def test_list_run_assets(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("a.csv", io.BytesIO(b"x"), "text/csv")},
    )
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("b.csv", io.BytesIO(b"y"), "text/csv")},
    )
    response = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert response.status_code == 200
    assert {a["filename"] for a in response.json()} == {"a.csv", "b.csv"}


def test_duplicate_filename_409(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("d.csv", io.BytesIO(b"y"), "text/csv")})
    assert response.status_code == 409


def test_disallowed_extension(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("evil.exe", io.BytesIO(b"x"), "application/octet-stream")})
    assert response.status_code == 400


def test_delete_unreferenced(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}")
    assert response.status_code == 204


def test_serve_asset_admin(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"hello"), "text/csv")})
    response = admin_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"hello"


def test_non_member_cannot_serve(auth_client, admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = auth_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 403
