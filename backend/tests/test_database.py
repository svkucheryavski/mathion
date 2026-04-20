from sqlalchemy import text


def test_database_connection(db):
    result = db.execute(text("SELECT 1"))
    assert result.scalar() == 1
