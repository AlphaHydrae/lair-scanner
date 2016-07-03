FROM phusion/baseimage:0.9.18

MAINTAINER Simon Oulevay (Alpha Hydrae) <docker@alphahydrae.com>

# Upgrade OS.
RUN apt-get update && apt-get upgrade -y -o Dpkg::Options::="--force-confold"

# Enable SSH.
RUN rm -f /etc/service/sshd/down
RUN /etc/my_init.d/00_regen_ssh_host_keys.sh

# Install Node.
RUN curl -sL https://deb.nodesource.com/setup_4.x | sudo -E bash -

# Install Git, nginx and Node.js.
RUN apt-get install -y git nodejs build-essential

# Install lair-scanner.
RUN mkdir -p /opt/lair-scanner
ADD package.json /opt/lair-scanner/package.json
RUN cd /opt/lair-scanner && npm install
ADD bin /opt/lair-scanner/bin
ADD lib /opt/lair-scanner/lib
ADD resources /opt/lair-scanner/resources
RUN echo "export PATH=/opt/lair-scanner/bin:$PATH" >> /root/.bashrc

# Clean caches.
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

EXPOSE 22

CMD ["/sbin/my_init"]
