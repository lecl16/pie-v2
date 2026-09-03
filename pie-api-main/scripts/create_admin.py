"""
Bootstrap the first admin user.

POST /users/create is admin-only, so there's no way to create the very first
account through the API. Run this once, directly against the database, to
create an account you can then log in with.

Usage (from inside the app container, so it reuses the same DATABASE_URL):
    docker compose exec app python scripts/create_admin.py
"""
import getpass
import sys

from app.core.database import SessionLocal, init_db
from app.core.security import hash_password
from app.models.db.user import User


def main():
    init_db()
    db = SessionLocal()
    try:
        nmec = input("nmec (staff/student number, integer): ").strip()
        if not nmec.isdigit():
            sys.exit("nmec must be an integer")
        nmec = int(nmec)

        if db.query(User).filter(User.nmec == nmec).first():
            sys.exit(f"A user with nmec {nmec} already exists")

        name = input("Name: ").strip()
        email = input("Email: ").strip()

        if db.query(User).filter(User.email == email).first():
            sys.exit(f"A user with email {email} already exists")

        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            sys.exit("Passwords do not match")

        user = User(
            nmec=nmec,
            name=name,
            email=email,
            password=hash_password(password),
            role="admin",
        )
        db.add(user)
        db.commit()
        print(f"Created admin user {email} (nmec {nmec}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
