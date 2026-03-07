import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY: str = os.getenv('JWT_SECRET_KEY')
    ALGORITHM: str = os.getenv('ALGORITHM', 'HS256')
    
    # Existing config entries
    REDIS_URL: str = os.getenv('REDIS_URL', 'redis://redis:6379')
    DATABASE_URL: str = os.getenv('DATABASE_URL', 'mysql+pymysql://pie:pie123@db:3306/pie_api_db')
    
    ELASTICSEARCH_URL: str = os.getenv('ELASTICSEARCH_URL', 'http://elasticsearch:9200')
    ELASTICSEARCH_PORT: int = int(os.getenv('ELASTICSEARCH_PORT', '9200'))
    ELASTICSEARCH_HOST: str = os.getenv('ELASTICSEARCH_HOST', 'elasticsearch')
    
    LOG_RETENTION_DAYS: int = int(os.getenv('LOG_RETENTION_DAYS', '7'))
    LOG_MAX_STREAM_LENGTH: int = int(os.getenv('LOG_MAX_STREAM_LENGTH', '1000'))

config = Config()